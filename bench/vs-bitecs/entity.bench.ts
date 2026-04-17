/**
 * nvx-ecs vs bitECS — entity lifecycle throughput.
 *
 * Both libraries exercise the same total work: allocate N entities, then
 * either keep them alive or churn them through create→destroy cycles.
 *
 * Note on fairness:
 *  - bitECS entity ids are plain numbers starting at 1 (0 is reserved).
 *  - nvx-ecs entity refs are `uint32` + per-slot generation. `isAlive()`
 *    costs one extra typed-array lookup vs bitECS which skips that check.
 *  - bitECS `removeEntity` is immediate. nvx-ecs defers until flush; we
 *    include `flushPendingDestroys()` in the measurement.
 */

import { bench, describe } from 'vitest';
import * as bit from 'bitecs';
import { World as NvxWorld } from '../../src/core/world.js';
import { EntityStore as NvxEntityStore } from '../../src/core/entity.js';

const N = 10_000;
const ITER = 100;

describe(`Entity create — ${N} fresh entities`, () => {
    bench(
        'nvx-ecs  EntityStore.create()',
        () => {
            const store = new NvxEntityStore(16);
            for (let i = 0; i < N; i++) store.create();
        },
        { iterations: ITER },
    );

    bench(
        'bitECS   addEntity()',
        () => {
            const world = bit.createWorld();
            for (let i = 0; i < N; i++) bit.addEntity(world);
        },
        { iterations: ITER },
    );
});

describe(`Entity churn — ${N} create + immediate destroy`, () => {
    bench(
        'nvx-ecs  EntityStore (slot reuse, generation bump)',
        () => {
            const store = new NvxEntityStore(16);
            for (let i = 0; i < N; i++) {
                const h = store.create();
                store.destroy(h);
            }
        },
        { iterations: ITER },
    );

    bench(
        'bitECS   addEntity + removeEntity',
        () => {
            const world = bit.createWorld();
            for (let i = 0; i < N; i++) {
                const e = bit.addEntity(world);
                bit.removeEntity(world, e);
            }
        },
        { iterations: ITER },
    );
});

describe(`World-level lifecycle — ${N} entities, all destroyed, flushed`, () => {
    bench(
        'nvx-ecs  World.createEntity + destroyEntity + flushPendingDestroys',
        () => {
            const world = new NvxWorld();
            const handles = new Array(N);
            for (let i = 0; i < N; i++) handles[i] = world.createEntity();
            for (let i = 0; i < N; i++) world.destroyEntity(handles[i]);
            world.flushPendingDestroys();
        },
        { iterations: ITER },
    );

    bench(
        'bitECS   addEntity + removeEntity (bulk)',
        () => {
            const world = bit.createWorld();
            const ids = new Array(N);
            for (let i = 0; i < N; i++) ids[i] = bit.addEntity(world);
            for (let i = 0; i < N; i++) bit.removeEntity(world, ids[i]);
        },
        { iterations: ITER },
    );
});
