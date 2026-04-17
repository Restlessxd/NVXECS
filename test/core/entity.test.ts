import { describe, expect, it } from 'vitest';
import { EntityStore } from '../../src/core/entity.js';

describe('EntityStore', () => {
    describe('create / destroy', () => {
        it('allocates fresh slots in monotonic order', () => {
            const store = new EntityStore(4);
            const a = store.create();
            const b = store.create();
            const c = store.create();
            expect(a.ref).toBe(0);
            expect(b.ref).toBe(1);
            expect(c.ref).toBe(2);
        });

        it('fresh slots start at generation 1', () => {
            const store = new EntityStore(4);
            const h = store.create();
            expect(h.gen).toBe(1);
        });

        it('tracks aliveCount', () => {
            const store = new EntityStore(4);
            expect(store.aliveCount).toBe(0);
            const a = store.create();
            const b = store.create();
            expect(store.aliveCount).toBe(2);
            store.destroy(a);
            expect(store.aliveCount).toBe(1);
            store.destroy(b);
            expect(store.aliveCount).toBe(0);
        });

        it('destroy returns true for live handle, false for stale', () => {
            const store = new EntityStore(4);
            const h = store.create();
            expect(store.destroy(h)).toBe(true);
            expect(store.destroy(h)).toBe(false); // already dead
        });

        it('destroy returns false for out-of-bounds ref', () => {
            const store = new EntityStore(4);
            expect(store.destroy({ ref: 99, gen: 1 })).toBe(false);
        });
    });

    describe('isAlive', () => {
        it('returns true for a live handle', () => {
            const store = new EntityStore(4);
            const h = store.create();
            expect(store.isAlive(h)).toBe(true);
        });

        it('returns false after destroy', () => {
            const store = new EntityStore(4);
            const h = store.create();
            store.destroy(h);
            expect(store.isAlive(h)).toBe(false);
        });

        it('returns false for out-of-bounds ref', () => {
            const store = new EntityStore(4);
            expect(store.isAlive({ ref: 999, gen: 1 })).toBe(false);
        });

        it('returns false for a forged handle with gen=0 on an allocated slot', () => {
            const store = new EntityStore(4);
            const h = store.create();
            // gen=0 is reserved sentinel — forging it must never validate.
            expect(store.isAlive({ ref: h.ref, gen: 0 })).toBe(false);
        });
    });

    describe('slot reuse + stale detection', () => {
        it('reuses freed slots before allocating fresh ones', () => {
            const store = new EntityStore(4);
            const a = store.create(); // ref 0
            const b = store.create(); // ref 1
            store.destroy(a);
            const c = store.create();
            expect(c.ref).toBe(0); // reused slot 0
            expect(b.ref).toBe(1);
        });

        it('bumps generation on reuse so old handles are stale', () => {
            const store = new EntityStore(4);
            const old = store.create(); // gen 1
            store.destroy(old);
            const reused = store.create(); // same ref, gen 2
            expect(reused.ref).toBe(old.ref);
            expect(reused.gen).toBe(old.gen + 1);
            expect(store.isAlive(old)).toBe(false);
            expect(store.isAlive(reused)).toBe(true);
        });

        it('distinguishes two new entities that happen to share a slot', () => {
            const store = new EntityStore(4);
            const first = store.create();
            store.destroy(first);
            const second = store.create();
            // Same slot, different gen — second must be alive, first must not.
            expect(second.ref).toBe(first.ref);
            expect(store.isAlive(first)).toBe(false);
            expect(store.isAlive(second)).toBe(true);
        });

        it('handles a long destroy/create churn without alive leaking', () => {
            const store = new EntityStore(8);
            for (let i = 0; i < 1000; i++) {
                const h = store.create();
                store.destroy(h);
            }
            expect(store.aliveCount).toBe(0);
            // Only one fresh slot should have ever been used.
            expect(store.slotsUsed).toBe(1);
        });
    });

    describe('growth', () => {
        it('grows the generation array past initial capacity', () => {
            const store = new EntityStore(2);
            const handles = [];
            for (let i = 0; i < 100; i++) {
                handles.push(store.create());
            }
            expect(store.aliveCount).toBe(100);
            expect(store.capacity).toBeGreaterThanOrEqual(100);
            // All handles should still be valid.
            for (const h of handles) {
                expect(store.isAlive(h)).toBe(true);
            }
        });

        it('preserves existing generations across growth', () => {
            const store = new EntityStore(2);
            const a = store.create();
            const b = store.create();
            store.destroy(a);
            const reused = store.create(); // gen 2 at slot 0
            // Trigger growth
            for (let i = 0; i < 50; i++) store.create();
            expect(store.isAlive(reused)).toBe(true);
            expect(store.isAlive(b)).toBe(true);
            expect(store.isAlive(a)).toBe(false);
        });
    });

    describe('generationOf', () => {
        it('returns 0 for never-allocated slots', () => {
            const store = new EntityStore(4);
            expect(store.generationOf(0)).toBe(0);
            expect(store.generationOf(99)).toBe(0);
        });

        it('returns current gen for allocated slot', () => {
            const store = new EntityStore(4);
            const h = store.create();
            expect(store.generationOf(h.ref)).toBe(1);
            store.destroy(h);
            expect(store.generationOf(h.ref)).toBe(2);
        });
    });
});
