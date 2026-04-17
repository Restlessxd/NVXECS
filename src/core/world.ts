/**
 * The World is the central orchestrator of an ECS instance.
 *
 * Owns:
 *  - {@link EntityStore} — slot allocator with generations.
 *  - {@link ComponentRegistry} — per-component storage + membership bitmask.
 *  - Deferred-destroy queue (parallel Uint32Arrays, zero-alloc on insert).
 *
 * Queries and systems arrive in subsequent layers; they consume the storage
 * and bitmask owned by this class.
 */

import { DEFAULT_ENTITY_CAPACITY } from '../internal/constants.js';
import { EventBus } from '../events/bus.js';
import type { EventDef, EventInit, EventView } from '../events/types.js';
import { QueryBuilder } from '../query/builder.js';
import { ComponentRegistry, type ComponentInfo } from '../schema/registry.js';
import type {
    ComponentDef,
    ComponentInit,
    ComponentView,
    FieldMap,
} from '../schema/types.js';
import { Scheduler, type SchedulerOptions } from '../system/scheduler.js';
import type { System } from '../system/system.js';
import { EntityStore } from './entity.js';
import type { EntityHandle, EntityRef, Generation } from '../types/index.js';

export interface WorldOptions {
    /** Initial entity-slot capacity. The store grows automatically. */
    initialEntityCapacity?: number;
    /** Scheduler configuration (stage order). */
    scheduler?: SchedulerOptions;
}

export class World {
    private readonly _entities: EntityStore;
    private readonly _registry: ComponentRegistry;
    private readonly _events: EventBus;
    private readonly _scheduler: Scheduler;

    /**
     * Hoisted aliases onto the registry's hot membership data. Caching these
     * once at construction removes two property lookups per `has()` call
     * and lets V8 treat them as stable monomorphic fields.
     *
     * The underlying `Uint32Array` may be reallocated when the bitmask grows
     * its entity capacity — `_bitmaskRefCheck` is refreshed in `createEntity`
     * before the first hot-path check sees it.
     */
    private _bitmaskData: Uint32Array;
    private _bitmaskChunksPerEntity: number;
    private _bitmaskEntityCap: number;
    private readonly _componentInfo: Map<ComponentDef, { readonly id: number; readonly generationId: number; readonly bitflag: number }>;

    /**
     * Destruction is deferred until {@link flushPendingDestroys} is called
     * (typically by the scheduler at the end of a tick). Within a tick, an
     * entity marked for destruction remains alive so systems can observe it
     * during the same frame.
     *
     * Stored as parallel typed arrays to avoid object allocation on destroy.
     */
    private _pendingRefs: Uint32Array;
    private _pendingGens: Uint32Array;
    private _pendingCount = 0;

    constructor(opts: WorldOptions = {}) {
        const cap = opts.initialEntityCapacity ?? DEFAULT_ENTITY_CAPACITY;
        this._entities = new EntityStore(cap);
        this._registry = new ComponentRegistry(cap);
        this._events = new EventBus();
        this._scheduler = new Scheduler(this, opts.scheduler);
        this._pendingRefs = new Uint32Array(64);
        this._pendingGens = new Uint32Array(64);
        // Cache references to the registry's hot membership structures. On
        // bitmask growth we refresh these in `_refreshBitmaskCache`.
        const bm = this._registry.bitmask;
        this._bitmaskData = bm.data;
        this._bitmaskChunksPerEntity = bm.chunksPerEntity;
        this._bitmaskEntityCap = bm.entityCapacity;
        this._componentInfo = this._registry.infoByDef;
    }

    /** Refresh cached bitmask pointers. Must be called after any structural growth. */
    private _refreshBitmaskCache(): void {
        const bm = this._registry.bitmask;
        this._bitmaskData = bm.data;
        this._bitmaskChunksPerEntity = bm.chunksPerEntity;
        this._bitmaskEntityCap = bm.entityCapacity;
    }

    /** Number of currently alive entities (pending-destroys still count). */
    get aliveEntityCount(): number {
        return this._entities.aliveCount;
    }

    /** Number of destroys queued for the next {@link flushPendingDestroys}. */
    get pendingDestroyCount(): number {
        return this._pendingCount;
    }

    /** Current slot capacity. */
    get entityCapacity(): number {
        return this._entities.capacity;
    }

    /** Advanced: direct access to the component registry. */
    get registry(): ComponentRegistry {
        return this._registry;
    }

    /** Advanced: direct access to the system scheduler. */
    get scheduler(): Scheduler {
        return this._scheduler;
    }

    /** Advanced: direct access to the event bus. */
    get events(): EventBus {
        return this._events;
    }

    // ─── Entity lifecycle ────────────────────────────────────────────────

    /** Allocate a new entity. Returns a handle. */
    createEntity(): EntityHandle {
        const handle = this._entities.create();
        // Entity slot grew past the bitmask's cached capacity → refresh aliases.
        if (handle.ref >= this._bitmaskEntityCap) this._refreshBitmaskCache();
        return handle;
    }

    /**
     * Queue an entity for destruction at the end of the current tick.
     *
     * Safe to call multiple times with the same handle — only the first call
     * will successfully destroy during flush; subsequent calls no-op because
     * the generation will already have been bumped.
     */
    destroyEntity(handle: EntityHandle): void {
        if (this._pendingCount >= this._pendingRefs.length) {
            this._growPending();
        }
        this._pendingRefs[this._pendingCount] = handle.ref;
        this._pendingGens[this._pendingCount] = handle.gen;
        this._pendingCount++;
    }

    /**
     * Apply all deferred destructions. Each destroyed entity has all of its
     * components removed via {@link ComponentRegistry.removeAll} before its
     * slot is freed and its generation bumped.
     *
     * Returns the count of entities actually destroyed (stale or duplicate
     * entries are silently skipped).
     */
    flushPendingDestroys(): number {
        const refs = this._pendingRefs;
        const gens = this._pendingGens;
        const n = this._pendingCount;
        let destroyed = 0;

        for (let i = 0; i < n; i++) {
            const ref = refs[i]!;
            const gen = gens[i]!;
            // Validate against the store first — stale entries are skipped
            // without touching components (which would otherwise double-remove
            // if the slot has already been reused).
            if (!this._entities.isAlive({ ref, gen })) continue;

            this._registry.removeAll(ref);
            this._entities.destroy({ ref, gen });
            destroyed++;
        }

        this._pendingCount = 0;
        return destroyed;
    }

    /** Is this handle still bound to its original entity? */
    isAlive(handle: EntityHandle): boolean {
        return this._entities.isAlive(handle);
    }

    /** Current stored generation for `ref`. Returns `0` if never allocated. */
    generationOf(ref: EntityRef): Generation {
        return this._entities.generationOf(ref);
    }

    // ─── Component registration & access ─────────────────────────────────

    /**
     * Register a component definition with this world. Returns the assigned
     * component id. Registration is idempotent — re-registering the same
     * definition returns the existing id.
     */
    register(def: ComponentDef): number {
        return this._registry.register(def);
    }

    /**
     * Build a typed view over a component's storage. Call once per system
     * invocation (not once per entity) and read field arrays directly in
     * tight loops.
     */
    view<F extends FieldMap>(def: ComponentDef<F>): ComponentView<F> {
        return this._registry.view(def);
    }

    /**
     * Attach a component to an entity, optionally initializing its fields.
     *
     * Any field omitted from `init` keeps its zero-initialized default.
     */
    add<F extends FieldMap>(
        handle: EntityHandle,
        def: ComponentDef<F>,
        init?: ComponentInit<F>,
    ): void {
        this._registry.add(handle.ref, def, init);
    }

    /**
     * Fast-path component attach: flip the membership bits without running
     * the init dispatch. Returns the field-array index to write into.
     *
     * Use in hot spawn loops where you already have the field arrays in
     * local variables and can write them directly:
     *
     * ```ts
     * const { x, y } = world.view(Position);
     * for (let i = 0; i < BATCH; i++) {
     *     const e = world.createEntity();
     *     const idx = world.attachEmpty(e, Position);
     *     x[idx] = i * 10;
     *     y[idx] = i * 20;
     * }
     * ```
     *
     * The returned index semantics mirror `add`:
     *  - sparse mode: the sparse set's dense slot.
     *  - dense mode: `handle.ref` itself.
     *
     * Avoids allocating an init object plus the per-field switch dispatch
     * inside the registry.
     */
    attachEmpty(handle: EntityHandle, def: ComponentDef): number {
        return this._registry.attachEmpty(handle.ref, def);
    }

    /** Detach a component from an entity. Returns `true` if it was attached. */
    remove(handle: EntityHandle, def: ComponentDef): boolean {
        return this._registry.remove(handle.ref, def);
    }

    /**
     * Does this entity currently have this component?
     *
     * Fully inlined using precomputed `ComponentInfo` + cached bitmask
     * pointers — no function-call chain into registry/bitmask, no shifts
     * on the hot path.
     */
    has(handle: EntityHandle, def: ComponentDef): boolean {
        const info = this._componentInfo.get(def);
        if (info === undefined) return false;
        const ref = handle.ref;
        if (ref >= this._bitmaskEntityCap) return false;
        const mask = this._bitmaskData[ref * this._bitmaskChunksPerEntity + info.generationId]!;
        return (mask & info.bitflag) === info.bitflag;
    }

    /**
     * Fast-path `has` variant that takes a raw {@link EntityRef} rather than
     * an {@link EntityHandle}. Saves one property access per call — useful
     * inside hot system loops where the user is already iterating raw refs
     * (e.g. from a query snapshot).
     *
     * ⚠️ Does NOT validate the entity's generation. Callers that hold a
     * cross-tick reference and need stale-ref safety should use {@link has}.
     */
    hasById(ref: EntityRef, def: ComponentDef): boolean {
        const info = this._componentInfo.get(def);
        if (info === undefined) return false;
        if (ref >= this._bitmaskEntityCap) return false;
        const mask = this._bitmaskData[ref * this._bitmaskChunksPerEntity + info.generationId]!;
        return (mask & info.bitflag) === info.bitflag;
    }

    /**
     * Absolute-fastest `has` — caller has already resolved a
     * {@link ComponentInfo} via {@link infoOf} and passes it directly. Skips
     * the component-map lookup entirely.
     *
     * Typical usage: resolve `info` once at system init, index by raw `ref`
     * inside the hot loop.
     *
     * ```ts
     * const posInfo = world.infoOf(Position)!;
     * for (const ref of q.snapshot().refs) {
     *     if (world.hasByInfo(ref, posInfo)) // ...
     * }
     * ```
     */
    hasByInfo(ref: EntityRef, info: ComponentInfo): boolean {
        if (ref >= this._bitmaskEntityCap) return false;
        const mask = this._bitmaskData[ref * this._bitmaskChunksPerEntity + info.generationId]!;
        return (mask & info.bitflag) === info.bitflag;
    }

    /** Resolve a component's precomputed `{ id, generationId, bitflag }` for use with {@link hasByInfo}. */
    infoOf(def: ComponentDef): ComponentInfo | undefined {
        return this._componentInfo.get(def);
    }

    // ─── Queries ─────────────────────────────────────────────────────────

    /**
     * Start building a query. Finalize with `.build()` and reuse the returned
     * {@link Query} instance across ticks — masks are cached per-query.
     *
     * ```ts
     * const moving = world.query().with(Position, Velocity).without(Frozen).build();
     * moving.forEach(ref => { ... });
     * ```
     */
    query(): QueryBuilder {
        return new QueryBuilder(this._registry);
    }

    // ─── Events ──────────────────────────────────────────────────────────

    /** Register an event definition with this world. Shortcut for `world.events.register(def)`. */
    registerEvent(def: EventDef): void {
        this._events.register(def);
    }

    /** Emit an event into its channel's current-tick buffer. */
    emit<F extends FieldMap>(def: EventDef<F>, init?: EventInit<F>): void {
        this._events.emit(def, init);
    }

    /** Read the event buffer for this tick. See {@link EventView}. */
    readEvents<F extends FieldMap>(def: EventDef<F>): EventView<F> {
        return this._events.read(def);
    }

    // ─── Systems & tick ──────────────────────────────────────────────────

    /** Register a system. Shortcut for `world.scheduler.register(system)`. */
    registerSystem(system: System): void {
        this._scheduler.register(system);
    }

    /** Unregister a system by name. Returns `true` if it was present. */
    unregisterSystem(name: string): boolean {
        return this._scheduler.unregister(name);
    }

    /** Swap a named system's implementation. Entity/component state is preserved. */
    replaceSystem(name: string, next: System): boolean {
        return this._scheduler.replace(name, next);
    }

    /**
     * Execute one tick: run every stage's systems in topological order, then
     * flush the deferred-destroy queue. Shortcut for
     * `world.scheduler.tick(dt)`.
     */
    tick(dt: number): void {
        this._scheduler.tick(dt);
    }

    // ─── Internals ───────────────────────────────────────────────────────

    private _growPending(): void {
        const next = this._pendingRefs.length * 2;
        const refs = new Uint32Array(next);
        const gens = new Uint32Array(next);
        refs.set(this._pendingRefs);
        gens.set(this._pendingGens);
        this._pendingRefs = refs;
        this._pendingGens = gens;
    }
}
