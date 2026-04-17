/**
 * Low-level entity slot allocator.
 *
 * Owns two parallel structures:
 *  - `_generations: Uint32Array` — current generation for each slot. Bumped on destroy.
 *  - `_freeList: Uint32Array`    — stack of slot indices awaiting reuse.
 *
 * Slot lifecycle:
 *   1. {@link create} returns a fresh slot (`_nextFresh++`) or pops the free-list.
 *   2. {@link destroy} bumps the slot's generation and pushes it onto the free-list.
 *   3. Future {@link create} calls pop the free-list and return a handle with the
 *      already-bumped generation, so stale handles fail {@link isAlive}.
 *
 * Generations are 32-bit counters. At realistic churn (≪ 1 reuse/sec per slot) a
 * 32-bit counter takes 136 years to wrap — effectively infinite.
 */

import { DEFAULT_ENTITY_CAPACITY, GROWTH_FACTOR } from '../internal/constants.js';
import type { EntityHandle, EntityRef, Generation } from '../types/index.js';

export class EntityStore {
    /** Per-slot generation. `0` = never allocated. `≥1` = slot has been used at least once. */
    private _generations: Uint32Array;

    /** Free-list stack — slot indices awaiting reuse. `_freeCount` is the current depth. */
    private _freeList: Uint32Array;
    private _freeCount = 0;

    /** Next never-before-used slot index. Slots `[0, _nextFresh)` have been allocated at least once. */
    private _nextFresh = 0;

    /** Current allocated length of `_generations`. */
    private _capacity: number;

    /** Number of currently alive entities (alive = stored gen matches a live handle somewhere). */
    private _aliveCount = 0;

    constructor(initialCapacity: number = DEFAULT_ENTITY_CAPACITY) {
        this._capacity = Math.max(1, initialCapacity);
        this._generations = new Uint32Array(this._capacity);
        this._freeList = new Uint32Array(this._capacity);
    }

    /** Number of currently alive entities. */
    get aliveCount(): number {
        return this._aliveCount;
    }

    /** Current slot capacity (length of the generation array). */
    get capacity(): number {
        return this._capacity;
    }

    /** Total slots allocated at least once (`alive + free-listed`). */
    get slotsUsed(): number {
        return this._nextFresh;
    }

    /** Allocate a new entity and return its handle. O(1) amortized. */
    create(): EntityHandle {
        let ref: EntityRef;

        if (this._freeCount > 0) {
            // Reuse a freed slot. Its generation was bumped during destroy.
            ref = this._freeList[--this._freeCount]!;
        } else {
            // Grow if we're about to run out of fresh slots.
            if (this._nextFresh >= this._capacity) {
                this._grow();
            }
            ref = this._nextFresh++;
            // Fresh slots begin at generation 1. Generation 0 is reserved as
            // "never allocated" so a forged handle `{ref, gen: 0}` can never match.
            this._generations[ref] = 1;
        }

        this._aliveCount++;
        return { ref, gen: this._generations[ref]! };
    }

    /**
     * Destroy the entity referenced by `handle`.
     *
     * Returns `true` if the handle matched a live entity (destruction happened),
     * `false` if the handle is stale or out-of-bounds (no-op).
     */
    destroy(handle: EntityHandle): boolean {
        const { ref, gen } = handle;

        // Out-of-bounds refs can never be alive.
        if (ref >= this._nextFresh) return false;

        const stored = this._generations[ref]!;
        if (stored !== gen) return false; // stale or already destroyed

        // Bump generation — all existing handles to this slot become stale.
        // Skip 0 on wrap to preserve the "never allocated" sentinel.
        const next = (stored + 1) >>> 0;
        this._generations[ref] = next === 0 ? 1 : next;

        // Grow free-list if needed before pushing.
        if (this._freeCount >= this._freeList.length) {
            const grown = new Uint32Array(this._freeList.length * GROWTH_FACTOR);
            grown.set(this._freeList);
            this._freeList = grown;
        }
        this._freeList[this._freeCount++] = ref;

        this._aliveCount--;
        return true;
    }

    /** Check whether the handle still refers to the same live entity. O(1). */
    isAlive(handle: EntityHandle): boolean {
        const { ref, gen } = handle;
        if (ref >= this._nextFresh) return false;
        return this._generations[ref] === gen;
    }

    /**
     * Fetch the current generation for a raw `ref`.
     * Returns `0` (the `INVALID_GEN` sentinel) if the slot was never allocated.
     * Returns the *current* gen, which may or may not correspond to a live entity.
     */
    generationOf(ref: EntityRef): Generation {
        if (ref >= this._nextFresh) return 0;
        return this._generations[ref]!;
    }

    /** Double the generation-array capacity. Called automatically by {@link create}. */
    private _grow(): void {
        const newCapacity = this._capacity * GROWTH_FACTOR;
        const grown = new Uint32Array(newCapacity);
        grown.set(this._generations);
        this._generations = grown;
        this._capacity = newCapacity;
    }
}
