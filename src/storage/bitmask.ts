/**
 * Per-entity component membership bitmask.
 *
 * Layout: one 1D `Uint32Array` of `entityCapacity * chunksPerEntity` slots,
 * where each entity occupies a contiguous run of `chunksPerEntity` chunks.
 * Each chunk holds 32 component bits. With a default of 2 chunks per entity,
 * the bitmask supports 64 components; more chunks can be allocated via
 * {@link growChunks} when new components are registered.
 *
 * The 1D layout lets `matches()` compute a base offset once per entity and
 * sweep its chunks with a single addition per iteration — faster than
 * dereferencing a chunks-of-arrays outer container.
 *
 * Query matching is just a bitwise-AND of the entity's chunks against a
 * prepared include/exclude mask — one of the cheapest operations a CPU can do.
 */

import { growTypedArray } from '../utils/typed-array.js';
import type { EntityRef } from '../types/index.js';

const DEFAULT_ENTITY_CAPACITY = 1024;
const DEFAULT_CHUNKS_PER_ENTITY = 2; // = 64 components before first chunk growth
const GROWTH_FACTOR = 2;
const BITS_PER_CHUNK = 32;

export class EntityBitmask {
    /**
     * Flat membership buffer indexed by `ref * chunksPerEntity + chunk`.
     *
     * Public + readonly so hot-path callers (e.g. {@link World.has}) can cache
     * the reference and do direct indexed reads without property dispatch.
     * Treat the contents as read-only from outside the class.
     */
    data: Uint32Array;

    private _entityCapacity: number;
    private _chunksPerEntity: number;

    constructor(
        entityCapacity: number = DEFAULT_ENTITY_CAPACITY,
        chunksPerEntity: number = DEFAULT_CHUNKS_PER_ENTITY,
    ) {
        this._entityCapacity = Math.max(1, entityCapacity);
        this._chunksPerEntity = Math.max(1, chunksPerEntity);
        this.data = new Uint32Array(this._entityCapacity * this._chunksPerEntity);
    }

    /** Maximum entity index that currently fits without growing. */
    get entityCapacity(): number {
        return this._entityCapacity;
    }

    /** Number of 32-bit chunks per entity row. `32 * chunksPerEntity` = max component count. */
    get chunksPerEntity(): number {
        return this._chunksPerEntity;
    }

    /** Maximum component id supported without a {@link growChunks} call. */
    get componentCapacity(): number {
        return this._chunksPerEntity * BITS_PER_CHUNK;
    }

    /** Set the bit for `componentId` on `ref`. */
    set(ref: EntityRef, componentId: number): void {
        this._ensureEntity(ref);
        this._ensureComponent(componentId);
        const base = ref * this._chunksPerEntity;
        const generationId = componentId >>> 5;
        const bitflag = 1 << (componentId & 31);
        this.data[base + generationId]! |= bitflag;
    }

    /** Clear the bit for `componentId` on `ref`. */
    clear(ref: EntityRef, componentId: number): void {
        if (ref >= this._entityCapacity) return;
        if (componentId >= this.componentCapacity) return;
        const base = ref * this._chunksPerEntity;
        const generationId = componentId >>> 5;
        const bitflag = 1 << (componentId & 31);
        this.data[base + generationId]! &= ~bitflag;
    }

    /** Check whether `ref` has the bit set for `componentId`. */
    has(ref: EntityRef, componentId: number): boolean {
        if (ref >= this._entityCapacity) return false;
        if (componentId >= this.componentCapacity) return false;
        const base = ref * this._chunksPerEntity;
        const generationId = componentId >>> 5;
        const bitflag = 1 << (componentId & 31);
        return (this.data[base + generationId]! & bitflag) === bitflag;
    }

    /**
     * Fast-path membership check given precomputed `{ generationId, bitflag }`.
     *
     * Callers that registered the component ahead of time can store the
     * precomputed `generationId` (= `componentId >>> 5`) and `bitflag`
     * (= `1 << (componentId & 31)`) once per component and avoid these shifts
     * on every check.
     */
    hasFlag(ref: EntityRef, generationId: number, bitflag: number): boolean {
        if (ref >= this._entityCapacity) return false;
        return (this.data[ref * this._chunksPerEntity + generationId]! & bitflag) === bitflag;
    }

    /** Clear *every* component bit for `ref`. Useful when destroying an entity. */
    clearAll(ref: EntityRef): void {
        if (ref >= this._entityCapacity) return;
        const base = ref * this._chunksPerEntity;
        for (let i = 0; i < this._chunksPerEntity; i++) {
            this.data[base + i] = 0;
        }
    }

    /**
     * Test whether the entity's chunks match a query mask.
     *
     *  - `include` — all bits here must be set on the entity.
     *  - `exclude` — none of these bits may be set on the entity.
     *
     * Both masks are `Uint32Array`s of length ≥ `chunksPerEntity`.
     * Passing `null` for `exclude` skips the check.
     */
    matches(ref: EntityRef, include: Uint32Array, exclude: Uint32Array | null): boolean {
        if (ref >= this._entityCapacity) return false;
        const data = this.data;
        const n = this._chunksPerEntity;
        const base = ref * n;
        for (let i = 0; i < n; i++) {
            const entityChunk = data[base + i]!;
            const incChunk = include[i]!;
            if ((entityChunk & incChunk) !== incChunk) return false;
            if (exclude !== null && (entityChunk & exclude[i]!) !== 0) return false;
        }
        return true;
    }

    /**
     * Grow entity-row capacity to at least `minCapacity`. No-op if already larger.
     * Called automatically by {@link set} when an unknown high-index ref is written.
     */
    growEntities(minCapacity: number): void {
        if (minCapacity <= this._entityCapacity) return;
        let next = this._entityCapacity * GROWTH_FACTOR;
        while (next < minCapacity) next *= GROWTH_FACTOR;
        this.data = growTypedArray(this.data, next * this._chunksPerEntity);
        this._entityCapacity = next;
    }

    /**
     * Grow chunk-per-entity capacity (= max supported component id).
     *
     * Requires reinterleaving data: per-entity rows expand, so we allocate a
     * new backing array and copy rows one by one.
     */
    growChunks(newChunksPerEntity: number): void {
        if (newChunksPerEntity <= this._chunksPerEntity) return;
        const oldChunks = this._chunksPerEntity;
        const next = new Uint32Array(this._entityCapacity * newChunksPerEntity);
        for (let e = 0; e < this._entityCapacity; e++) {
            const oldBase = e * oldChunks;
            const newBase = e * newChunksPerEntity;
            for (let i = 0; i < oldChunks; i++) {
                next[newBase + i] = this.data[oldBase + i]!;
            }
        }
        this.data = next;
        this._chunksPerEntity = newChunksPerEntity;
    }

    private _ensureEntity(ref: EntityRef): void {
        if (ref >= this._entityCapacity) this.growEntities(ref + 1);
    }

    private _ensureComponent(componentId: number): void {
        if (componentId >= this.componentCapacity) {
            const needed = Math.floor(componentId / BITS_PER_CHUNK) + 1;
            this.growChunks(needed);
        }
    }
}
