import { describe, expect, it } from 'vitest';
import { ComponentStore } from '../../src/storage/component-store.js';
import type { FieldSpec } from '../../src/storage/types.js';

const POSITION_FIELDS: FieldSpec[] = [
    { name: 'x', kind: 'f32' },
    { name: 'y', kind: 'f32' },
];

const MIXED_FIELDS: FieldSpec[] = [
    { name: 'health', kind: 'i32' },
    { name: 'alive', kind: 'bool' },
    { name: 'target', kind: 'ref' },
    { name: 'inventory', kind: 'side' },
];

describe('ComponentStore', () => {
    describe('construction', () => {
        it('allocates one typed array per numeric field', () => {
            const store = new ComponentStore(POSITION_FIELDS, { initialDenseCapacity: 8 });
            expect(store.numericField('x')).toBeInstanceOf(Float32Array);
            expect(store.numericField('y')).toBeInstanceOf(Float32Array);
            expect(store.numericField('x').length).toBe(8);
        });

        it('maps "bool" kind to Uint8Array', () => {
            const store = new ComponentStore([{ name: 'alive', kind: 'bool' }], {
                initialDenseCapacity: 4,
            });
            expect(store.numericField('alive')).toBeInstanceOf(Uint8Array);
        });

        it('allocates ref and side fields', () => {
            const store = new ComponentStore(MIXED_FIELDS, { initialDenseCapacity: 4 });
            const target = store.refField('target');
            expect(target.index).toBeInstanceOf(Uint32Array);
            expect(target.generation).toBeInstanceOf(Uint32Array);
            expect(store.sideField('inventory').size).toBe(0);
        });

        it('throws on unknown field lookups', () => {
            const store = new ComponentStore(POSITION_FIELDS);
            expect(() => store.numericField('z')).toThrow(/numeric field "z"/);
            expect(() => store.refField('z')).toThrow(/ref field "z"/);
            expect(() => store.sideField('z')).toThrow(/side field "z"/);
        });
    });

    describe('add', () => {
        it('assigns dense indices in order', () => {
            const store = new ComponentStore(POSITION_FIELDS, { initialDenseCapacity: 4 });
            expect(store.add(10)).toBe(0);
            expect(store.add(20)).toBe(1);
            expect(store.count).toBe(2);
        });

        it('allows data writes at the returned dense index', () => {
            const store = new ComponentStore(POSITION_FIELDS, { initialDenseCapacity: 4 });
            const x = store.numericField('x') as Float32Array;
            const y = store.numericField('y') as Float32Array;
            const i = store.add(42);
            x[i] = 1.5;
            y[i] = -3.25;
            expect(x[i]).toBeCloseTo(1.5);
            expect(y[i]).toBeCloseTo(-3.25);
        });

        it('returns the existing index when the ref is already present', () => {
            const store = new ComponentStore(POSITION_FIELDS);
            store.add(1);
            store.add(2);
            expect(store.add(1)).toBe(0);
            expect(store.count).toBe(2);
        });
    });

    describe('remove', () => {
        it('swaps the last entry into the vacated slot for numeric fields', () => {
            const store = new ComponentStore(POSITION_FIELDS, { initialDenseCapacity: 4 });
            const x = () => store.numericField('x') as Float32Array;
            const y = () => store.numericField('y') as Float32Array;

            const i0 = store.add(10);
            x()[i0] = 1;
            y()[i0] = 10;
            const i1 = store.add(20);
            x()[i1] = 2;
            y()[i1] = 20;
            const i2 = store.add(30);
            x()[i2] = 3;
            y()[i2] = 30;

            // Remove 10. Entity 30 should move into slot 0.
            expect(store.remove(10)).toBe(true);
            expect(store.count).toBe(2);
            expect(store.indexOf(30)).toBe(0);
            expect(x()[0]).toBeCloseTo(3);
            expect(y()[0]).toBeCloseTo(30);

            // Entity 20 should be untouched at slot 1.
            expect(store.indexOf(20)).toBe(1);
            expect(x()[1]).toBeCloseTo(2);
            expect(y()[1]).toBeCloseTo(20);
        });

        it('swaps ref fields alongside numerics', () => {
            const store = new ComponentStore(MIXED_FIELDS);
            const target = store.refField('target');
            const i0 = store.add(1);
            target.index[i0] = 100;
            target.generation[i0] = 5;
            const i1 = store.add(2);
            target.index[i1] = 200;
            target.generation[i1] = 7;

            store.remove(1);
            // Entity 2 swapped into slot 0 — its ref data should come with it.
            expect(target.index[0]).toBe(200);
            expect(target.generation[0]).toBe(7);
        });

        it('drops side-table entries for the removed entity only', () => {
            const store = new ComponentStore(MIXED_FIELDS);
            const inv = store.sideField<string[]>('inventory');
            store.add(1);
            store.add(2);
            inv.set(1, ['apple']);
            inv.set(2, ['rock']);
            store.remove(1);
            expect(inv.has(1)).toBe(false);
            expect(inv.get(2)).toEqual(['rock']);
        });

        it('returns false when removing a ref not in the store', () => {
            const store = new ComponentStore(POSITION_FIELDS);
            expect(store.remove(999)).toBe(false);
        });

        it('handles removal of the last entry without spurious swaps', () => {
            const store = new ComponentStore(POSITION_FIELDS);
            store.add(1);
            store.add(2);
            const x = store.numericField('x') as Float32Array;
            x[0] = 10;
            x[1] = 20;
            store.remove(2); // last
            expect(store.count).toBe(1);
            expect(x[0]).toBeCloseTo(10);
        });
    });

    describe('growth', () => {
        it('grows every parallel array when dense runs out', () => {
            const store = new ComponentStore(POSITION_FIELDS, { initialDenseCapacity: 2 });
            for (let i = 0; i < 50; i++) store.add(i);

            expect(store.count).toBe(50);
            expect(store.denseCapacity).toBeGreaterThanOrEqual(50);
            expect(store.numericField('x').length).toBe(store.denseCapacity);
            expect(store.numericField('y').length).toBe(store.denseCapacity);
        });

        it('preserves existing data across growth', () => {
            const store = new ComponentStore(POSITION_FIELDS, { initialDenseCapacity: 2 });
            const x = () => store.numericField('x') as Float32Array;
            const i0 = store.add(0);
            x()[i0] = 7.5;
            const i1 = store.add(1);
            x()[i1] = 9.25;
            for (let i = 2; i < 50; i++) store.add(i);
            // Original values should still be there after growth(s).
            expect(x()[0]).toBeCloseTo(7.5);
            expect(x()[1]).toBeCloseTo(9.25);
        });

        it('also grows ref fields', () => {
            const store = new ComponentStore(MIXED_FIELDS, { initialDenseCapacity: 2 });
            for (let i = 0; i < 20; i++) {
                const idx = store.add(i);
                store.refField('target').index[idx] = i * 10;
            }
            const target = store.refField('target');
            for (let i = 0; i < 20; i++) {
                expect(target.index[i]).toBe(i * 10);
            }
        });
    });
});
