/**
 * A built query over a {@link World}.
 *
 * Iteration strategy:
 *  1. Pick the **driver** — the include-component with the smallest count.
 *     Its dense array bounds the iteration; every matching entity must appear
 *     in at least this one store.
 *  2. Walk the driver's dense array. For each ref, check the entity's bitmask
 *     row against the pre-built `include` / `exclude` masks.
 *  3. Yield / invoke the callback for each match.
 *
 * ## Match caching
 *
 * Iteration results are cached in a dedicated `Uint32Array` on the query.
 * The cache is lazily invalidated when any involved component store's
 * `structuralVersion` changes — that is, whenever an add / remove touches
 * one of the query's include or exclude components. Between structural
 * changes, every `forEach`, `collectInto`, or iterator call walks the
 * cached list directly — **no bitmask check, no driver selection**.
 *
 * This closes most of the gap to direct-entity-id libraries (bitECS-style)
 * on stable-component workloads, while keeping correctness under churn.
 *
 * Single-include, zero-exclude queries still hit a special fast path that
 * returns the driver store's dense array as the cache — zero copy.
 */

import { buildComponentMask } from './matcher.js';
import type { ComponentStore } from '../storage/component-store.js';
import type { EntityBitmask } from '../storage/bitmask.js';
import type { ComponentRegistry } from '../schema/registry.js';
import type { ComponentDef } from '../schema/types.js';
import type { EntityRef } from '../types/index.js';

export type QueryForEachCallback = (ref: EntityRef) => void;

/**
 * Zero-alloc iteration snapshot returned by {@link Query.snapshot}. The
 * object reference is reused — mutate neither field; use them as read-only.
 */
export interface QuerySnapshot {
    refs: Uint32Array;
    count: number;
}

export class Query {
    readonly include: readonly ComponentDef[];
    readonly exclude: readonly ComponentDef[];
    private readonly _registry: ComponentRegistry;
    private readonly _includeIds: readonly number[];
    private readonly _excludeIds: readonly number[];
    private readonly _includeStores: readonly ComponentStore[];
    private readonly _excludeStores: readonly ComponentStore[];
    private readonly _fastPath: boolean;

    private _cachedIncludeMask: Uint32Array | null = null;
    private _cachedExcludeMask: Uint32Array | null = null;
    private _cachedChunksPerEntity = -1;

    /** Match cache. `_cachedCount` bounds the valid prefix. */
    private _cache: Uint32Array = new Uint32Array(0);
    private _cachedCount = 0;

    /**
     * Snapshot of every involved store's `structuralVersion` at the time of
     * the last cache rebuild. Indexed `[...include, ...exclude]`.
     */
    private _versionSnapshots: Int32Array;

    /** Whether the cache has ever been built. */
    private _cacheInitialized = false;

    /** Reused snapshot object — returned by {@link snapshot}, filled in place. */
    private readonly _snapshotObj: QuerySnapshot = { refs: new Uint32Array(0), count: 0 };

    /** @internal constructed by {@link QueryBuilder.build}. */
    constructor(
        registry: ComponentRegistry,
        include: readonly ComponentDef[],
        exclude: readonly ComponentDef[],
    ) {
        if (include.length === 0) {
            throw new Error('[nvx-ecs] query must have at least one with() component');
        }
        this._registry = registry;
        this.include = include;
        this.exclude = exclude;
        this._includeIds = include.map((def) => registry.idOf(def));
        this._excludeIds = exclude.map((def) => registry.idOf(def));
        this._includeStores = include.map((def) => registry.storeOf(def));
        this._excludeStores = exclude.map((def) => registry.storeOf(def));
        this._fastPath = include.length === 1 && exclude.length === 0;
        this._versionSnapshots = new Int32Array(include.length + exclude.length).fill(-1);
    }

    /**
     * Number of entities that currently match.
     *
     * After the first call, subsequent calls are O(1) until a structural
     * change invalidates the cache.
     */
    count(): number {
        this._ensureCache();
        return this._cachedCount;
    }

    /**
     * Direct access to the cached match list. The returned `Uint32Array` is
     * owned by the query — do not store it across tick boundaries, as it may
     * be reallocated on cache rebuild. Only indices `[0, count())` are valid.
     */
    cachedRefs(): Uint32Array {
        this._ensureCache();
        return this._cache;
    }

    /**
     * Zero-copy snapshot pair for the tightest possible user loop. After the
     * call, `matches.refs` is a valid `Uint32Array` and `matches.count` holds
     * the match count. Both are owned by the query — treat them as read-only.
     *
     * The returned object is reused across calls (same reference every time),
     * so this does **not** allocate per tick.
     *
     * ```ts
     * const snap = q.snapshot();
     * for (let i = 0; i < snap.count; i++) {
     *     const ref = snap.refs[i];
     *     // ...
     * }
     * ```
     */
    snapshot(): QuerySnapshot {
        this._ensureCache();
        const snap = this._snapshotObj;
        snap.refs = this._cache;
        snap.count = this._cachedCount;
        return snap;
    }

    /**
     * Invoke `cb` once per matching entity. The callback is monomorphic
     * under typical usage and inlines efficiently.
     */
    forEach(cb: QueryForEachCallback): void {
        this._ensureCache();
        const cache = this._cache;
        const n = this._cachedCount;
        for (let i = 0; i < n; i++) cb(cache[i]!);
    }

    /**
     * Collect matching entity refs into the caller-provided array. Returns
     * the number of matches written (`out.length` is also adjusted).
     */
    collectInto(out: EntityRef[]): number {
        this._ensureCache();
        const cache = this._cache;
        const n = this._cachedCount;
        for (let i = 0; i < n; i++) out[i] = cache[i]!;
        out.length = n;
        return n;
    }

    /** `for ... of` support. Walks the cached list; no allocation per match. */
    *[Symbol.iterator](): IterableIterator<EntityRef> {
        this._ensureCache();
        const cache = this._cache;
        const n = this._cachedCount;
        for (let i = 0; i < n; i++) yield cache[i]!;
    }

    // ─── Internals ───────────────────────────────────────────────────────

    /** Rebuild the cache when any involved store's structural version has changed. */
    private _ensureCache(): void {
        if (this._cacheInitialized && this._versionsMatch()) return;
        this._rebuildCache();
    }

    private _versionsMatch(): boolean {
        const snap = this._versionSnapshots;
        const incl = this._includeStores;
        const excl = this._excludeStores;
        for (let i = 0; i < incl.length; i++) {
            if (snap[i] !== incl[i]!.structuralVersion) return false;
        }
        const offset = incl.length;
        for (let j = 0; j < excl.length; j++) {
            if (snap[offset + j] !== excl[j]!.structuralVersion) return false;
        }
        return true;
    }

    private _snapshotVersions(): void {
        const snap = this._versionSnapshots;
        const incl = this._includeStores;
        const excl = this._excludeStores;
        for (let i = 0; i < incl.length; i++) snap[i] = incl[i]!.structuralVersion;
        const offset = incl.length;
        for (let j = 0; j < excl.length; j++) snap[offset + j] = excl[j]!.structuralVersion;
    }

    private _rebuildCache(): void {
        const driver = this._pickDriver();
        const dense = driver.sparseSet.dense;
        const count = driver.sparseSet.count;

        // Fast path: zero-exclude, single-include → the driver's dense IS the match list.
        if (this._fastPath) {
            this._cache = dense; // direct reference — cache is a view, rebuilt on version change
            this._cachedCount = count;
            this._cacheInitialized = true;
            this._snapshotVersions();
            return;
        }

        if (this._cache.length < count) this._cache = new Uint32Array(count);
        const cache = this._cache;

        const bitmask = this._registry.bitmask;
        this._ensureMasks(bitmask);
        const include = this._cachedIncludeMask!;
        const exclude = this._cachedExcludeMask;

        let n = 0;
        for (let i = 0; i < count; i++) {
            const ref = dense[i]!;
            if (bitmask.matches(ref, include, exclude)) cache[n++] = ref;
        }
        this._cachedCount = n;
        this._cacheInitialized = true;
        this._snapshotVersions();
    }

    /** Pick the smallest-count include store to minimize rebuild cost. */
    private _pickDriver(): ComponentStore {
        const stores = this._includeStores;
        let driver = stores[0]!;
        let minCount = driver.count;
        for (let i = 1; i < stores.length; i++) {
            const store = stores[i]!;
            if (store.count < minCount) {
                driver = store;
                minCount = store.count;
            }
        }
        return driver;
    }

    /** Rebuild include/exclude masks when the bitmask has grown its chunk count. */
    private _ensureMasks(bitmask: EntityBitmask): void {
        const chunks = bitmask.chunksPerEntity;
        if (this._cachedChunksPerEntity === chunks) return;

        this._cachedIncludeMask = buildComponentMask(this._includeIds, chunks);
        this._cachedExcludeMask =
            this._excludeIds.length > 0 ? buildComponentMask(this._excludeIds, chunks) : null;
        this._cachedChunksPerEntity = chunks;
    }
}
