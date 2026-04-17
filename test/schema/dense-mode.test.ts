import { describe, expect, it } from 'vitest';
import { World } from '../../src/core/world.js';
import { defineComponent } from '../../src/schema/define.js';

const DensePos = defineComponent({
    name: 'DensePos',
    fields: { x: 'f32', y: 'f32' },
    storage: 'dense',
});

const SparsePos = defineComponent({
    name: 'SparsePos',
    fields: { x: 'f32', y: 'f32' },
});

describe('Dense storage mode', () => {
    describe('ComponentDef.storage flag', () => {
        it('defaults to sparse', () => {
            expect(SparsePos.storage).toBe('sparse');
        });

        it('honours explicit dense opt-in', () => {
            expect(DensePos.storage).toBe('dense');
        });
    });

    describe('dense-mode storage behaviour', () => {
        it('returns ref itself as the field index', () => {
            const w = new World({ initialEntityCapacity: 64 });
            w.register(DensePos);

            const e = w.createEntity();
            w.add(e, DensePos, { x: 10, y: 20 });

            const view = w.view(DensePos);
            // In dense mode, field arrays are indexed by ref directly.
            expect(view.x[e.ref]).toBeCloseTo(10);
            expect(view.y[e.ref]).toBeCloseTo(20);
        });

        it('indexOf returns ref in dense mode', () => {
            const w = new World();
            w.register(DensePos);
            const e = w.createEntity();
            w.add(e, DensePos, { x: 1, y: 1 });

            const store = w.registry.storeOf(DensePos);
            expect(store.indexOf(e.ref)).toBe(e.ref);
            expect(store.indexOf(9999)).toBe(-1);
        });

        it('grows field arrays when a higher ref is attached', () => {
            const w = new World({ initialEntityCapacity: 4 });
            w.register(DensePos);

            // Spawn enough entities to push refs past the initial dense capacity.
            const handles = [];
            for (let i = 0; i < 50; i++) {
                const e = w.createEntity();
                w.add(e, DensePos, { x: i, y: i * 10 });
                handles.push(e);
            }

            const view = w.view(DensePos);
            for (const h of handles) {
                expect(view.x[h.ref]).toBeCloseTo(h.ref === 0 ? 0 : view.x[h.ref]!);
                // Because entity slots were allocated in order, ref == spawn index.
                expect(view.x[h.ref]).toBeCloseTo(h.ref);
                expect(view.y[h.ref]).toBeCloseTo(h.ref * 10);
            }
        });

        it('maintains separate count from world-level capacity', () => {
            const w = new World();
            w.register(DensePos);
            for (let i = 0; i < 10; i++) {
                const e = w.createEntity();
                if (i % 2 === 0) w.add(e, DensePos, { x: i, y: i });
            }
            expect(w.registry.storeOf(DensePos).count).toBe(5);
            expect(w.aliveEntityCount).toBe(10);
        });
    });

    describe('dense-mode remove', () => {
        it('clears the component without swap-and-pop', () => {
            const w = new World();
            w.register(DensePos);
            const a = w.createEntity();
            const b = w.createEntity();
            w.add(a, DensePos, { x: 1, y: 10 });
            w.add(b, DensePos, { x: 2, y: 20 });

            // Slot B's data stays at view.x[b.ref] even after A is removed —
            // unlike sparse mode where swap-and-pop would have moved it.
            w.remove(a, DensePos);
            const view = w.view(DensePos);
            expect(view.x[b.ref]).toBeCloseTo(2);
            expect(view.y[b.ref]).toBeCloseTo(20);

            // has() reflects removal via the bitmask / sparse set.
            expect(w.has(a, DensePos)).toBe(false);
            expect(w.has(b, DensePos)).toBe(true);
        });

        it('next add overwrites stale data at the same slot', () => {
            const w = new World();
            w.register(DensePos);
            const e = w.createEntity();
            w.add(e, DensePos, { x: 99, y: 99 });
            w.remove(e, DensePos);
            w.add(e, DensePos, { x: 5, y: 7 });
            const view = w.view(DensePos);
            expect(view.x[e.ref]).toBeCloseTo(5);
            expect(view.y[e.ref]).toBeCloseTo(7);
        });
    });

    describe('iteration still works correctly in dense mode', () => {
        it('query.forEach walks the sparseSet.dense list (order of insertion)', () => {
            const w = new World();
            w.register(DensePos);
            const handles = [];
            for (let i = 0; i < 5; i++) {
                const e = w.createEntity();
                w.add(e, DensePos, { x: i, y: i });
                handles.push(e);
            }
            const q = w.query().with(DensePos).build();
            const seen: number[] = [];
            q.forEach((ref) => seen.push(ref));
            expect(seen.length).toBe(5);
            expect(new Set(seen)).toEqual(new Set(handles.map((h) => h.ref)));
        });

        it('multi-component queries mixing dense and sparse components work', () => {
            const w = new World();
            w.register(DensePos);
            w.register(SparsePos);

            const a = w.createEntity();
            const b = w.createEntity();
            const c = w.createEntity();
            // a: both, b: only dense, c: only sparse
            w.add(a, DensePos, { x: 1, y: 2 });
            w.add(a, SparsePos, { x: 10, y: 20 });
            w.add(b, DensePos, { x: 1, y: 2 });
            w.add(c, SparsePos, { x: 1, y: 2 });

            const q = w.query().with(DensePos, SparsePos).build();
            const matches: number[] = [];
            q.forEach((ref) => matches.push(ref));
            expect(matches).toEqual([a.ref]);
        });
    });

    describe('structural version tracking', () => {
        it('bumps structuralVersion on add and remove', () => {
            const w = new World();
            w.register(DensePos);
            const store = w.registry.storeOf(DensePos);
            expect(store.structuralVersion).toBe(0);

            const e = w.createEntity();
            w.add(e, DensePos, { x: 1, y: 1 });
            expect(store.structuralVersion).toBe(1);

            // Re-adding the same component is a no-op → no version bump
            w.add(e, DensePos, { x: 2, y: 2 });
            expect(store.structuralVersion).toBe(1);

            w.remove(e, DensePos);
            expect(store.structuralVersion).toBe(2);

            w.remove(e, DensePos); // already gone → no bump
            expect(store.structuralVersion).toBe(2);
        });

        it('sparse-mode stores also bump structuralVersion', () => {
            const w = new World();
            w.register(SparsePos);
            const store = w.registry.storeOf(SparsePos);
            const e = w.createEntity();
            w.add(e, SparsePos, { x: 0, y: 0 });
            expect(store.structuralVersion).toBe(1);
        });
    });
});
