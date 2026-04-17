/**
 * nvx-ecs vs bitECS — component attachment throughput.
 *
 * Workload: create N entities, attach 2 components (Position, Velocity) to
 * each, write two f32 fields per component. Structural-change cost lives
 * here; the actual math is trivially small.
 *
 * Fairness notes:
 *  - bitECS requires the user to pre-allocate typed arrays to max entity
 *    count. We follow that convention.
 *  - nvx-ecs grows dynamically; we pass `initialDenseCapacity: N` so the
 *    first run has no growth.
 */

import { bench, describe } from 'vitest';
import * as bit from 'bitecs';
import { World as NvxWorld } from '../../src/core/world.js';
import { defineComponent } from '../../src/schema/define.js';

const N = 10_000;
const ITER = 50;

const NvxPosition = defineComponent({
    name: 'Position',
    fields: { x: 'f32', y: 'f32' },
    storage: 'dense',
});
const NvxVelocity = defineComponent({
    name: 'Velocity',
    fields: { vx: 'f32', vy: 'f32' },
    storage: 'dense',
});

describe(`Attach 2 components to ${N} entities (+ numeric writes)`, () => {
    bench(
        'nvx-ecs  world.add(entity, Position, { x, y })',
        () => {
            const world = new NvxWorld({ initialEntityCapacity: N });
            world.register(NvxPosition);
            world.register(NvxVelocity);
            for (let i = 0; i < N; i++) {
                const e = world.createEntity();
                world.add(e, NvxPosition, { x: i, y: i });
                world.add(e, NvxVelocity, { vx: 1, vy: 1 });
            }
        },
        { iterations: ITER },
    );

    bench(
        'nvx-ecs  attachEmpty + direct field write (dense)',
        () => {
            const world = new NvxWorld({ initialEntityCapacity: N });
            world.register(NvxPosition);
            world.register(NvxVelocity);
            const pos = world.view(NvxPosition);
            const vel = world.view(NvxVelocity);
            const posX = pos.x;
            const posY = pos.y;
            const velVX = vel.vx;
            const velVY = vel.vy;
            for (let i = 0; i < N; i++) {
                const e = world.createEntity();
                const pi = world.attachEmpty(e, NvxPosition);
                posX[pi] = i;
                posY[pi] = i;
                const vi = world.attachEmpty(e, NvxVelocity);
                velVX[vi] = 1;
                velVY[vi] = 1;
            }
        },
        { iterations: ITER },
    );

    bench(
        'bitECS   addComponent + direct array write',
        () => {
            const world = bit.createWorld();
            // Pre-allocated typed arrays sized to the max entity index.
            const Position = { x: new Float32Array(N + 1), y: new Float32Array(N + 1) };
            const Velocity = { vx: new Float32Array(N + 1), vy: new Float32Array(N + 1) };
            for (let i = 0; i < N; i++) {
                const e = bit.addEntity(world);
                bit.addComponent(world, e, Position);
                Position.x[e] = i;
                Position.y[e] = i;
                bit.addComponent(world, e, Velocity);
                Velocity.vx[e] = 1;
                Velocity.vy[e] = 1;
            }
        },
        { iterations: ITER },
    );
});

describe(`Remove component from ${N} entities (middle-out)`, () => {
    bench(
        'nvx-ecs  world.remove(e, Position) × 5,000 (swap-and-pop)',
        () => {
            const world = new NvxWorld({ initialEntityCapacity: N });
            world.register(NvxPosition);
            const handles: Array<ReturnType<typeof world.createEntity>> = [];
            for (let i = 0; i < N; i++) {
                const e = world.createEntity();
                world.add(e, NvxPosition, { x: 0, y: 0 });
                handles.push(e);
            }
            // Remove every other entity to exercise the swap-and-pop path.
            for (let i = 0; i < N; i += 2) world.remove(handles[i]!, NvxPosition);
        },
        { iterations: ITER },
    );

    bench(
        'bitECS   removeComponent × 5,000',
        () => {
            const world = bit.createWorld();
            const Position = { x: new Float32Array(N + 1), y: new Float32Array(N + 1) };
            const ids: number[] = [];
            for (let i = 0; i < N; i++) {
                const e = bit.addEntity(world);
                bit.addComponent(world, e, Position);
                ids.push(e);
            }
            for (let i = 0; i < N; i += 2) bit.removeComponent(world, ids[i]!, Position);
        },
        { iterations: ITER },
    );
});

describe(`hasComponent/has check over ${N} entities`, () => {
    bench(
        'nvx-ecs  world.has(entity, Component)',
        () => {
            const world = new NvxWorld({ initialEntityCapacity: N });
            world.register(NvxPosition);
            const handles = [];
            for (let i = 0; i < N; i++) {
                const e = world.createEntity();
                world.add(e, NvxPosition, { x: 0, y: 0 });
                handles.push(e);
            }
            let count = 0;
            for (let i = 0; i < handles.length; i++) {
                if (world.has(handles[i]!, NvxPosition)) count++;
            }
            if (count !== N) throw new Error('bench invariant failed');
        },
        { iterations: ITER },
    );

    bench(
        'nvx-ecs  world.hasById(ref, Component) — raw ref, Map.get inside',
        () => {
            const world = new NvxWorld({ initialEntityCapacity: N });
            world.register(NvxPosition);
            const refs: number[] = [];
            for (let i = 0; i < N; i++) {
                const e = world.createEntity();
                world.add(e, NvxPosition, { x: 0, y: 0 });
                refs.push(e.ref);
            }
            let count = 0;
            for (let i = 0; i < refs.length; i++) {
                if (world.hasById(refs[i]!, NvxPosition)) count++;
            }
            if (count !== N) throw new Error('bench invariant failed');
        },
        { iterations: ITER },
    );

    bench(
        'nvx-ecs  world.hasByInfo(ref, info) — pre-resolved info, zero Map.get',
        () => {
            const world = new NvxWorld({ initialEntityCapacity: N });
            world.register(NvxPosition);
            const refs: number[] = [];
            for (let i = 0; i < N; i++) {
                const e = world.createEntity();
                world.add(e, NvxPosition, { x: 0, y: 0 });
                refs.push(e.ref);
            }
            const info = world.infoOf(NvxPosition)!;
            let count = 0;
            for (let i = 0; i < refs.length; i++) {
                if (world.hasByInfo(refs[i]!, info)) count++;
            }
            if (count !== N) throw new Error('bench invariant failed');
        },
        { iterations: ITER },
    );

    bench(
        'bitECS   hasComponent(world, entity, Component)',
        () => {
            const world = bit.createWorld();
            const Position = { x: new Float32Array(N + 1), y: new Float32Array(N + 1) };
            const ids: number[] = [];
            for (let i = 0; i < N; i++) {
                const e = bit.addEntity(world);
                bit.addComponent(world, e, Position);
                ids.push(e);
            }
            let count = 0;
            for (let i = 0; i < ids.length; i++) {
                if (bit.hasComponent(world, ids[i]!, Position)) count++;
            }
            if (count !== N) throw new Error('bench invariant failed');
        },
        { iterations: ITER },
    );
});
