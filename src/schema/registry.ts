/**
 * Per-world component registry.
 *
 * Responsibilities:
 *  - Assign a unique `componentId` (small integer) per {@link ComponentDef}.
 *    Component IDs index into the {@link EntityBitmask} and identify storage.
 *  - Own the {@link ComponentStore} for every registered component.
 *  - Own the {@link EntityBitmask} that tracks which components each entity has.
 *  - Apply init values to fresh component rows on `add`.
 *  - Cascade removals when an entity is destroyed.
 *
 * The registry is an internal detail of {@link World} but is also exposed as
 * public API for advanced users (custom storage backends, inspection, etc.).
 */

import { EntityBitmask } from '../storage/bitmask.js';
import { ComponentStore } from '../storage/component-store.js';
import type { FieldSpec } from '../storage/types.js';
import type { EntityRef, EntityHandle } from '../types/index.js';
import type { ComponentDef, ComponentInit, ComponentView, FieldMap } from './types.js';

/**
 * Precomputed lookup slice stored per registered component.
 *
 * `generationId` indexes into {@link EntityBitmask.chunks}; `bitflag` is the
 * pre-shifted `1 << (id & 31)` mask for the component's bit. Holding both in
 * one frozen object lets hot-path membership checks become
 * `(chunks[info.generationId][ref] & info.bitflag) === info.bitflag` —
 * no shifts, no multiplies, no function-call chain.
 */
export interface ComponentInfo {
    readonly id: number;
    readonly generationId: number;
    readonly bitflag: number;
}

export class ComponentRegistry {
    /**
     * Per-entity component membership. Exposed read-only so that hot-path
     * callers (e.g. {@link World.has}) can cache `.chunks` once per tick.
     */
    readonly bitmask: EntityBitmask;

    /**
     * Per-definition lookup of precomputed {@link ComponentInfo}. Public +
     * readonly so callers can hoist `infoByDef.get(def)` outside hot loops.
     */
    readonly infoByDef: Map<ComponentDef, ComponentInfo> = new Map();

    private readonly _defById: ComponentDef[] = [];
    private readonly _storeById: ComponentStore[] = [];
    private readonly _infoById: ComponentInfo[] = [];
    private _nextId = 0;

    /** Initial capacity passed along to dense-mode component stores. */
    private readonly _initialEntityCapacity: number;

    constructor(initialEntityCapacity: number) {
        this._initialEntityCapacity = initialEntityCapacity;
        this.bitmask = new EntityBitmask(initialEntityCapacity);
    }

    /** Number of registered components. */
    get componentCount(): number {
        return this._nextId;
    }

    /**
     * Register a component definition. Returns the assigned component id
     * (which also indexes into {@link bitmask}).
     *
     * Re-registering an already-known definition returns the existing id —
     * registration is idempotent so tests and dynamic loaders can safely
     * re-invoke it.
     */
    register(def: ComponentDef): number {
        const existing = this.infoByDef.get(def);
        if (existing !== undefined) return existing.id;

        const id = this._nextId++;
        const generationId = id >>> 5;
        const bitflag = 1 << (id & 31);
        const info: ComponentInfo = Object.freeze({ id, generationId, bitflag });

        const specs: FieldSpec[] = [];
        for (const [name, kind] of Object.entries(def.fields)) {
            specs.push({ name, kind });
        }

        this.infoByDef.set(def, info);
        this._defById.push(def);
        this._infoById.push(info);
        this._storeById.push(
            new ComponentStore(specs, {
                mode: def.storage,
                initialDenseModeCapacity: this._initialEntityCapacity,
            }),
        );

        // Ensure the bitmask is wide enough to cover this component right away
        // so that `has()` can assume `chunks[generationId]` exists without a
        // secondary bounds check.
        if (generationId >= this.bitmask.chunksPerEntity) {
            this.bitmask.growChunks(generationId + 1);
        }

        return id;
    }

    /** Is this definition registered? */
    isRegistered(def: ComponentDef): boolean {
        return this.infoByDef.has(def);
    }

    /** Get the id for a registered component. Throws if unregistered. */
    idOf(def: ComponentDef): number {
        const info = this.infoByDef.get(def);
        if (info === undefined) {
            throw new Error(`[nvx-ecs] component "${def.name}" is not registered with this world`);
        }
        return info.id;
    }

    /**
     * Get the precomputed `{ id, generationId, bitflag }` for a registered
     * component, or `undefined` if it isn't registered. Used by the fast path
     * in {@link World.has}.
     */
    infoOf(def: ComponentDef): ComponentInfo | undefined {
        return this.infoByDef.get(def);
    }

    /** Get the storage for a registered component. Throws if unregistered. */
    storeOf(def: ComponentDef): ComponentStore {
        return this._storeById[this.idOf(def)]!;
    }

    /**
     * Typed view over a component's storage. Returns the **same cached
     * object** every call — no allocation, no field-map iteration. The view
     * is kept in sync with growth automatically: field-array references
     * inside it are mutated in place when storage reallocates, so a cached
     * view never goes stale.
     *
     * Safe to call anywhere, including hot inner loops. Typical usage still
     * hoists to `init()` or the top of `update()` simply because it reads
     * cleaner — but there is no perf penalty for per-entity calls.
     */
    view<F extends FieldMap>(def: ComponentDef<F>): ComponentView<F> {
        return this.storeOf(def).view() as ComponentView<F>;
    }

    /**
     * Attach a component to an entity. Writes any provided init values into
     * the fresh row and flips the bitmask bit.
     */
    add<F extends FieldMap>(ref: EntityRef, def: ComponentDef<F>, init?: ComponentInit<F>): void {
        const info = this.infoByDef.get(def);
        if (info === undefined) {
            throw new Error(`[nvx-ecs] component "${def.name}" is not registered with this world`);
        }
        const store = this._storeById[info.id]!;
        const denseIndex = store.add(ref);
        this._setBit(ref, info);

        if (init !== undefined) {
            this._applyInit(store, def, ref, denseIndex, init);
        }
    }

    /**
     * Fast-path attach without init dispatch. Returns the field-array index
     * the caller should use for direct writes. See {@link World.attachEmpty}.
     */
    attachEmpty(ref: EntityRef, def: ComponentDef): number {
        const info = this.infoByDef.get(def);
        if (info === undefined) {
            throw new Error(`[nvx-ecs] component "${def.name}" is not registered with this world`);
        }
        const store = this._storeById[info.id]!;
        const idx = store.add(ref);
        this._setBit(ref, info);
        return idx;
    }

    /**
     * Detach a component from an entity. Returns `true` if it was present,
     * `false` if the entity didn't have this component.
     */
    remove(ref: EntityRef, def: ComponentDef): boolean {
        const info = this.infoByDef.get(def);
        if (info === undefined) return false;
        const store = this._storeById[info.id]!;
        if (!store.remove(ref)) return false;
        this._clearBit(ref, info);
        return true;
    }

    /** Does this entity have this component? */
    has(ref: EntityRef, def: ComponentDef): boolean {
        const info = this.infoByDef.get(def);
        if (info === undefined) return false;
        const bm = this.bitmask;
        if (ref >= bm.entityCapacity) return false;
        return (
            (bm.data[ref * bm.chunksPerEntity + info.generationId]! & info.bitflag) ===
            info.bitflag
        );
    }

    /**
     * Remove every component this entity owns. Called by the world's
     * deferred-destroy flush so that stores stay in sync with entity lifetimes.
     *
     * Walks the bitmask in chunks and extracts set bits via `Math.clz32` to
     * iterate only the components the entity actually has — O(K) rather than
     * O(N_registered). Essential for worlds with many registered components
     * where the average entity uses only a handful.
     */
    removeAll(ref: EntityRef): void {
        const bm = this.bitmask;
        if (ref >= bm.entityCapacity) return;
        const chunksPerEntity = bm.chunksPerEntity;
        const data = bm.data;
        const stores = this._storeById;
        const base = ref * chunksPerEntity;

        for (let c = 0; c < chunksPerEntity; c++) {
            let chunk = data[base + c]!;
            if (chunk === 0) continue;
            const chunkBase = c << 5; // c * 32
            while (chunk !== 0) {
                // Lowest set bit via two's-complement trick:
                //   chunk & -chunk → mask with only the LSB set
                //   31 - clz32(lsb) → that bit's position within the chunk
                const lsb = chunk & -chunk;
                const bitIndex = 31 - Math.clz32(lsb);
                stores[chunkBase + bitIndex]!.remove(ref);
                chunk ^= lsb; // clear the processed bit
            }
        }

        bm.clearAll(ref);
    }

    /** Set the bit for `info` on `ref`, growing the bitmask if needed. */
    private _setBit(ref: EntityRef, info: ComponentInfo): void {
        const bm = this.bitmask;
        if (ref >= bm.entityCapacity) bm.growEntities(ref + 1);
        const base = ref * bm.chunksPerEntity;
        bm.data[base + info.generationId]! |= info.bitflag;
    }

    /** Clear the bit for `info` on `ref`. No-op if `ref` is out of range. */
    private _clearBit(ref: EntityRef, info: ComponentInfo): void {
        const bm = this.bitmask;
        if (ref >= bm.entityCapacity) return;
        const base = ref * bm.chunksPerEntity;
        bm.data[base + info.generationId]! &= ~info.bitflag;
    }

    private _applyInit<F extends FieldMap>(
        store: ComponentStore,
        _def: ComponentDef<F>,
        ref: EntityRef,
        denseIndex: number,
        init: ComponentInit<F>,
    ): void {
        // Iterate `store.fields` (cached FieldSpec[]) instead of
        // `Object.entries(def.fields)`. The latter allocates a fresh array of
        // `[name, kind]` tuples on every call — with 4-field components that's
        // ~100 bytes of short-lived GC pressure per attach, which adds up
        // quickly in spawn-heavy loops.
        const fields = store.fields;
        const initRecord = init as Record<string, unknown>;
        for (let i = 0; i < fields.length; i++) {
            const field = fields[i]!;
            const value = initRecord[field.name];
            if (value === undefined) continue;

            switch (field.kind) {
                case 'f32':
                case 'f64':
                case 'i8':
                case 'u8':
                case 'i16':
                case 'u16':
                case 'i32':
                case 'u32':
                    store.numericField(field.name)[denseIndex] = value as number;
                    break;
                case 'bool':
                    store.numericField(field.name)[denseIndex] =
                        value === true || value === 1
                            ? 1
                            : value === false || value === 0
                              ? 0
                              : (value as number);
                    break;
                case 'ref': {
                    const handle = value as EntityHandle;
                    const pair = store.refField(field.name);
                    pair.index[denseIndex] = handle.ref;
                    pair.generation[denseIndex] = handle.gen;
                    break;
                }
                case 'side':
                    store.sideField(field.name).set(ref, value);
                    break;
                default: {
                    const exhaustive: never = field.kind;
                    throw new Error(`[nvx-ecs] unknown field kind: ${String(exhaustive)}`);
                }
            }
        }
    }
}
