/**
 * A sparse set mapping `EntityRef` → dense slot index.
 *
 * Storage layout:
 *  - `dense`  — compact `Uint32Array` of entity refs in insertion order.
 *               Parallel data arrays in {@link ComponentStore} share this indexing.
 *  - `sparse` — `Uint32Array` indexed directly by entity ref. Value at `sparse[ref]`
 *               is the dense position of that ref when `has(ref)` returns true.
 *
 * Operations:
 *  - `add`    — O(1). Appends to dense, updates sparse. Grows dense/sparse as needed.
 *  - `remove` — O(1) swap-and-pop. The last dense slot is moved into the vacated slot.
 *  - `has`    — O(1). `sparse[ref] < count && dense[sparse[ref]] === ref`.
 *
 * Iteration:
 *  ```ts
 *  const { dense, count } = set;
 *  for (let i = 0; i < count; i++) {
 *      const ref = dense[i];
 *      // ...
 *  }
 *  ```
 */

import { growTypedArray } from '../utils/typed-array.js';
import type { EntityRef } from '../types/index.js';
import type { RemoveResult } from './types.js';

const DEFAULT_DENSE_CAPACITY = 64;
const DEFAULT_SPARSE_CAPACITY = 64;
const GROWTH_FACTOR = 2;

/**
 * Called by {@link SparseSet.add} when the dense array grows. Parallel data arrays
 * in a {@link ComponentStore} use this hook to resize themselves in lockstep.
 */
export type DenseGrowHook = (newCapacity: number) => void;

export class SparseSet {
    private _dense: Uint32Array;
    private _sparse: Uint32Array;
    private _count = 0;

    constructor(
        initialDenseCapacity: number = DEFAULT_DENSE_CAPACITY,
        initialSparseCapacity: number = DEFAULT_SPARSE_CAPACITY,
    ) {
        this._dense = new Uint32Array(Math.max(1, initialDenseCapacity));
        this._sparse = new Uint32Array(Math.max(1, initialSparseCapacity));
    }

    /** Number of refs currently in the set. */
    get count(): number {
        return this._count;
    }

    /** Current backing size of the dense array. */
    get denseCapacity(): number {
        return this._dense.length;
    }

    /** Current backing size of the sparse array. */
    get sparseCapacity(): number {
        return this._sparse.length;
    }

    /**
     * Direct read access to the dense array.
     * Only the first `count` entries are meaningful.
     */
    get dense(): Uint32Array {
        return this._dense;
    }

    /**
     * Direct read access to the sparse array.
     * Valid only for refs `r` where `has(r)` returns `true`.
     */
    get sparse(): Uint32Array {
        return this._sparse;
    }

    /**
     * Add `ref` to the set.
     *
     * If already present, returns the existing dense index without changes.
     *
     * `onDenseGrow` is invoked *after* the dense array has been resized but
     * *before* the new entry is written, so callers can resize any parallel
     * data arrays they maintain.
     */
    add(ref: EntityRef, onDenseGrow?: DenseGrowHook): number {
        if (this.has(ref)) return this._sparse[ref]!;

        if (ref >= this._sparse.length) {
            this._growSparseTo(ref + 1);
        }

        if (this._count >= this._dense.length) {
            this._dense = growTypedArray(this._dense, this._dense.length * GROWTH_FACTOR);
            onDenseGrow?.(this._dense.length);
        }

        const idx = this._count++;
        this._dense[idx] = ref;
        this._sparse[ref] = idx;
        return idx;
    }

    /**
     * Remove `ref` via swap-and-pop. Returns the vacated slot and the ref
     * swapped into it (or `null` if the removed entry was the last).
     *
     * Returns `null` if `ref` was not in the set.
     */
    remove(ref: EntityRef): RemoveResult | null {
        if (!this.has(ref)) return null;

        const removedIndex = this._sparse[ref]!;
        const lastIndex = this._count - 1;

        if (removedIndex === lastIndex) {
            this._count--;
            return { removedIndex, movedRef: null };
        }

        const movedRef = this._dense[lastIndex]!;
        this._dense[removedIndex] = movedRef;
        this._sparse[movedRef] = removedIndex;
        this._count--;
        return { removedIndex, movedRef };
    }

    /** Is `ref` currently in the set? O(1). */
    has(ref: EntityRef): boolean {
        if (ref >= this._sparse.length) return false;
        const idx = this._sparse[ref]!;
        return idx < this._count && this._dense[idx] === ref;
    }

    /** Dense index of `ref`, or `-1` if not present. */
    indexOf(ref: EntityRef): number {
        return this.has(ref) ? this._sparse[ref]! : -1;
    }

    /** Remove all entries. Does not shrink backing storage. */
    clear(): void {
        this._count = 0;
    }

    private _growSparseTo(minCapacity: number): void {
        let next = Math.max(this._sparse.length * GROWTH_FACTOR, DEFAULT_SPARSE_CAPACITY);
        while (next < minCapacity) next *= GROWTH_FACTOR;
        this._sparse = growTypedArray(this._sparse, next);
    }
}
