/**
 * nvx-ecs vs bitECS — structural churn during simulated gameplay.
 *
 * A `.io` server doesn't just iterate; it constantly spawns mobs,
 * destroys projectiles, attaches effects, removes status conditions.
 * This benchmark stresses the structural-change path:
 *
 *   - Start with 5,000 entities, each carrying Position.
 *   - 100 ticks. On each tick:
 *       * Spawn 100 new entities with Position + Velocity.
 *       * Destroy 100 of the existing entities.
 *       * Walk the Position + Velocity query and mutate.
 *
 * This measures the combined cost of structural changes, cache
 * invalidation, and iteration — a realistic mix for a live-dynamic game.
 */

import { bench, describe } from 'vitest';
import * as bit from 'bitecs';
import { World as NvxWorld } from '../../src/core/world.js';
import { defineComponent } from '../../src/schema/define.js';

const BASE = 5_000;
const MAX_SLOTS = BASE + 100 * 100 + 100; // upper bound of simultaneously live entities + headroom
const SPAWN_PER_TICK = 100;
const DESTROY_PER_TICK = 100;
const TICKS = 100;
const DT = 1 / 30;
const ITER = 10;

const NvxPos = defineComponent({
    name: 'Position',
    fields: { x: 'f32', y: 'f32' },
    storage: 'dense',
});
const NvxVel = defineComponent({
    name: 'Velocity',
    fields: { vx: 'f32', vy: 'f32' },
    storage: 'dense',
});

describe(`Structural churn — 100 spawn + 100 destroy + iterate × ${TICKS} ticks`, () => {
    bench(
        'nvx-ecs  spawn + destroy + iterate',
        () => {
            const world = new NvxWorld({ initialEntityCapacity: MAX_SLOTS });
            world.register(NvxPos);
            world.register(NvxVel);

            const live: Array<ReturnType<typeof world.createEntity>> = [];
            for (let i = 0; i < BASE; i++) {
                const e = world.createEntity();
                world.add(e, NvxPos, { x: i, y: i });
                world.add(e, NvxVel, { vx: 1, vy: 0.5 });
                live.push(e);
            }

            const q = world.query().with(NvxPos, NvxVel).build();
            const pos = world.view(NvxPos);
            const vel = world.view(NvxVel);
            const px = pos.x;
            const py = pos.y;
            const vx = vel.vx;
            const vy = vel.vy;

            for (let t = 0; t < TICKS; t++) {
                // Destroy the oldest SPAWN_PER_TICK entities.
                for (let d = 0; d < DESTROY_PER_TICK; d++) {
                    const h = live.shift();
                    if (h !== undefined) world.destroyEntity(h);
                }
                world.flushPendingDestroys();

                // Spawn fresh ones.
                for (let s = 0; s < SPAWN_PER_TICK; s++) {
                    const e = world.createEntity();
                    world.add(e, NvxPos, { x: 0, y: 0 });
                    world.add(e, NvxVel, { vx: 1, vy: 0.5 });
                    live.push(e);
                }

                // Iterate.
                const snap = q.snapshot();
                const refs = snap.refs;
                const count = snap.count;
                for (let i = 0; i < count; i++) {
                    const ref = refs[i]!;
                    px[ref] = px[ref]! + vx[ref]! * DT;
                    py[ref] = py[ref]! + vy[ref]! * DT;
                }
            }
        },
        { iterations: ITER },
    );

    bench(
        'bitECS   spawn + destroy + iterate',
        () => {
            const world = bit.createWorld();
            const Position = { x: new Float32Array(MAX_SLOTS + 1), y: new Float32Array(MAX_SLOTS + 1) };
            const Velocity = { vx: new Float32Array(MAX_SLOTS + 1), vy: new Float32Array(MAX_SLOTS + 1) };

            const live: number[] = [];
            for (let i = 0; i < BASE; i++) {
                const e = bit.addEntity(world);
                bit.addComponent(world, e, Position);
                Position.x[e] = i;
                Position.y[e] = i;
                bit.addComponent(world, e, Velocity);
                Velocity.vx[e] = 1;
                Velocity.vy[e] = 0.5;
                live.push(e);
            }

            for (let t = 0; t < TICKS; t++) {
                // Destroy oldest.
                for (let d = 0; d < DESTROY_PER_TICK; d++) {
                    const e = live.shift();
                    if (e !== undefined) bit.removeEntity(world, e);
                }

                // Spawn fresh.
                for (let s = 0; s < SPAWN_PER_TICK; s++) {
                    const e = bit.addEntity(world);
                    bit.addComponent(world, e, Position);
                    Position.x[e] = 0;
                    Position.y[e] = 0;
                    bit.addComponent(world, e, Velocity);
                    Velocity.vx[e] = 1;
                    Velocity.vy[e] = 0.5;
                    live.push(e);
                }

                // Iterate.
                const ents = bit.query(world, [Position, Velocity]);
                for (let i = 0; i < ents.length; i++) {
                    const e = ents[i]!;
                    Position.x[e] = Position.x[e]! + Velocity.vx[e]! * DT;
                    Position.y[e] = Position.y[e]! + Velocity.vy[e]! * DT;
                }
            }
        },
        { iterations: ITER },
    );
});
