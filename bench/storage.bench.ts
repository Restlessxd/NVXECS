import { bench, describe } from 'vitest';
import { SparseSet } from '../src/storage/sparse-set.js';
import { EntityBitmask } from '../src/storage/bitmask.js';
import { ComponentStore } from '../src/storage/component-store.js';
import type { FieldSpec } from '../src/storage/types.js';

describe('SparseSet', () => {
    bench(
        'add 10,000 refs',
        () => {
            const s = new SparseSet(16, 16);
            for (let i = 0; i < 10_000; i++) s.add(i);
        },
        { iterations: 100 },
    );

    bench(
        'add + remove 10,000 refs (churn)',
        () => {
            const s = new SparseSet(16, 16);
            for (let i = 0; i < 10_000; i++) s.add(i);
            for (let i = 0; i < 10_000; i++) s.remove(i);
        },
        { iterations: 100 },
    );

    bench(
        'iterate dense (10,000 entries) x 10',
        () => {
            const s = new SparseSet();
            for (let i = 0; i < 10_000; i++) s.add(i);
            let sum = 0;
            for (let k = 0; k < 10; k++) {
                for (let i = 0; i < s.count; i++) sum += s.dense[i]!;
            }
            // prevent dead-code elimination
            if (sum < 0) throw new Error('impossible');
        },
        { iterations: 100 },
    );
});

describe('EntityBitmask', () => {
    bench(
        'set 10,000 entities x 8 components',
        () => {
            const bm = new EntityBitmask(16, 1);
            for (let i = 0; i < 10_000; i++) {
                for (let c = 0; c < 8; c++) bm.set(i, c);
            }
        },
        { iterations: 100 },
    );

    bench(
        'matches() over 10,000 entities',
        () => {
            const bm = new EntityBitmask(10_000, 1);
            for (let i = 0; i < 10_000; i++) {
                bm.set(i, 0);
                if (i % 2 === 0) bm.set(i, 1);
                if (i % 3 === 0) bm.set(i, 2);
            }
            const include = new Uint32Array([(1 << 0) | (1 << 1)]);
            let hits = 0;
            for (let i = 0; i < 10_000; i++) {
                if (bm.matches(i, include, null)) hits++;
            }
            if (hits < 0) throw new Error('impossible');
        },
        { iterations: 100 },
    );
});

describe('ComponentStore', () => {
    const POS: FieldSpec[] = [
        { name: 'x', kind: 'f32' },
        { name: 'y', kind: 'f32' },
    ];

    bench(
        'add 10,000 entities with 2 numeric fields',
        () => {
            const store = new ComponentStore(POS, { initialDenseCapacity: 16 });
            for (let i = 0; i < 10_000; i++) store.add(i);
        },
        { iterations: 100 },
    );

    bench(
        'remove from middle (swap-and-pop) 10,000 times',
        () => {
            const store = new ComponentStore(POS, { initialDenseCapacity: 16384 });
            for (let i = 0; i < 10_000; i++) store.add(i);
            // Remove evens from the front: every remove moves the last in.
            for (let i = 0; i < 5_000; i++) store.remove(i * 2);
        },
        { iterations: 100 },
    );

    bench(
        'tight-loop mutation of 10,000 f32 values x 100',
        () => {
            const store = new ComponentStore(POS, { initialDenseCapacity: 16 });
            for (let i = 0; i < 10_000; i++) {
                const idx = store.add(i);
                (store.numericField('x') as Float32Array)[idx] = i;
                (store.numericField('y') as Float32Array)[idx] = i;
            }
            const x = store.numericField('x') as Float32Array;
            const y = store.numericField('y') as Float32Array;
            const count = store.sparseSet.count;
            for (let k = 0; k < 100; k++) {
                for (let i = 0; i < count; i++) {
                    x[i] = x[i]! + 0.1;
                    y[i] = y[i]! + 0.2;
                }
            }
            if (x[0]! < 0) throw new Error('impossible');
        },
        { iterations: 100 },
    );
});
