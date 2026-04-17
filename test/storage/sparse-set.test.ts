import { describe, expect, it, vi } from 'vitest';
import { SparseSet } from '../../src/storage/sparse-set.js';

describe('SparseSet', () => {
    describe('add', () => {
        it('assigns dense indices in insertion order', () => {
            const set = new SparseSet();
            expect(set.add(10)).toBe(0);
            expect(set.add(20)).toBe(1);
            expect(set.add(30)).toBe(2);
            expect(set.count).toBe(3);
        });

        it('returns the existing index when a ref is re-added', () => {
            const set = new SparseSet();
            set.add(5);
            set.add(7);
            expect(set.add(5)).toBe(0);
            expect(set.count).toBe(2);
        });

        it('grows sparse to accommodate a high ref', () => {
            const set = new SparseSet(4, 4);
            set.add(1_000_000);
            expect(set.has(1_000_000)).toBe(true);
            expect(set.sparseCapacity).toBeGreaterThan(1_000_000);
        });

        it('calls onDenseGrow when dense reallocates', () => {
            const set = new SparseSet(2, 16);
            const hook = vi.fn();
            set.add(0, hook);
            set.add(1, hook); // fills initial capacity
            expect(hook).not.toHaveBeenCalled();
            set.add(2, hook); // triggers growth
            expect(hook).toHaveBeenCalledTimes(1);
            expect(hook).toHaveBeenCalledWith(4);
        });
    });

    describe('remove', () => {
        it('returns null for a ref that was never present', () => {
            const set = new SparseSet();
            expect(set.remove(999)).toBeNull();
        });

        it('handles removal of the last ref without a swap', () => {
            const set = new SparseSet();
            set.add(10);
            set.add(20);
            const result = set.remove(20);
            expect(result).toEqual({ removedIndex: 1, movedRef: null });
            expect(set.count).toBe(1);
            expect(set.has(20)).toBe(false);
        });

        it('swaps the last entry into the vacated slot', () => {
            const set = new SparseSet();
            set.add(10); // index 0
            set.add(20); // index 1
            set.add(30); // index 2
            const result = set.remove(10);
            expect(result).toEqual({ removedIndex: 0, movedRef: 30 });
            expect(set.count).toBe(2);
            expect(set.indexOf(30)).toBe(0); // 30 moved into slot 0
            expect(set.indexOf(20)).toBe(1); // 20 stayed at slot 1
        });

        it('allows a removed ref to be re-added cleanly', () => {
            const set = new SparseSet();
            set.add(10);
            set.add(20);
            set.remove(10);
            expect(set.add(10)).toBe(set.count - 1);
            expect(set.has(10)).toBe(true);
            expect(set.has(20)).toBe(true);
        });
    });

    describe('has / indexOf', () => {
        it('returns false / -1 for refs that were never added', () => {
            const set = new SparseSet();
            expect(set.has(0)).toBe(false);
            expect(set.has(500)).toBe(false);
            expect(set.indexOf(0)).toBe(-1);
        });

        it('returns false / -1 after removal', () => {
            const set = new SparseSet();
            set.add(42);
            set.remove(42);
            expect(set.has(42)).toBe(false);
            expect(set.indexOf(42)).toBe(-1);
        });

        it('is not fooled by stale sparse values after swap', () => {
            // Common sparse-set bug: a removed ref's sparse slot still points
            // somewhere valid; a naive has() check returns true. We verify the
            // dense-back-check catches this.
            const set = new SparseSet();
            set.add(10);
            set.add(20);
            set.remove(10); // slot 0 now holds 20; sparse[10] still reads 0
            expect(set.has(10)).toBe(false);
        });
    });

    describe('iteration', () => {
        it('exposes a dense view for tight loops', () => {
            const set = new SparseSet();
            set.add(7);
            set.add(14);
            set.add(21);
            const collected: number[] = [];
            for (let i = 0; i < set.count; i++) {
                collected.push(set.dense[i]!);
            }
            expect(collected).toEqual([7, 14, 21]);
        });
    });

    describe('clear', () => {
        it('resets count without freeing backing storage', () => {
            const set = new SparseSet();
            set.add(1);
            set.add(2);
            const denseCap = set.denseCapacity;
            set.clear();
            expect(set.count).toBe(0);
            expect(set.has(1)).toBe(false);
            expect(set.denseCapacity).toBe(denseCap);
        });
    });
});
