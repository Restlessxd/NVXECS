/**
 * nvx-ecs vs bitECS — query iteration.
 *
 * Realistic movement-system workload: for each entity matching
 * `Position + Velocity`, integrate position by velocity × dt. Repeated
 * across 100 ticks so per-iteration overhead is amortized.
 *
 * ENTITY_COUNT entities are created up-front; half of them have Velocity.
 * Both worlds run the same tick loop.
 */

import { bench, describe } from 'vitest';
import * as bit from 'bitecs';
import { World as NvxWorld } from '../../src/core/world.js';
import type { Query as NvxQuery } from '../../src/query/query.js';
import { defineComponent } from '../../src/schema/define.js';

const N = 10_000;
const TICKS = 100;
const DT = 1 / 30;
const ITER = 10;

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

describe(`Movement query — ${N} entities × ${TICKS} ticks (Position += Velocity*dt)`, () => {
    bench(
        'nvx-ecs  query.forEach + sparse lookup',
        () => {
            const world = new NvxWorld({ initialEntityCapacity: N });
            world.register(NvxPosition);
            world.register(NvxVelocity);
            for (let i = 0; i < N; i++) {
                const e = world.createEntity();
                world.add(e, NvxPosition, { x: i, y: i });
                if (i % 2 === 0) world.add(e, NvxVelocity, { vx: 1, vy: 0.5 });
            }
            const q: NvxQuery = world.query().with(NvxPosition, NvxVelocity).build();
            const posView = world.view(NvxPosition);
            const velView = world.view(NvxVelocity);
            const posX = posView.x;
            const posY = posView.y;
            const velVX = velView.vx;
            const velVY = velView.vy;

            // Dense mode: field arrays are indexed by ref directly — no sparse lookup needed.
            for (let t = 0; t < TICKS; t++) {
                q.forEach((ref) => {
                    posX[ref] = posX[ref]! + velVX[ref]! * DT;
                    posY[ref] = posY[ref]! + velVY[ref]! * DT;
                });
            }
        },
        { iterations: ITER },
    );

    bench(
        'nvx-ecs  query.snapshot() + plain for loop (dense)',
        () => {
            const world = new NvxWorld({ initialEntityCapacity: N });
            world.register(NvxPosition);
            world.register(NvxVelocity);
            for (let i = 0; i < N; i++) {
                const e = world.createEntity();
                world.add(e, NvxPosition, { x: i, y: i });
                if (i % 2 === 0) world.add(e, NvxVelocity, { vx: 1, vy: 0.5 });
            }
            const q = world.query().with(NvxPosition, NvxVelocity).build();
            const posView = world.view(NvxPosition);
            const velView = world.view(NvxVelocity);
            const posX = posView.x;
            const posY = posView.y;
            const velVX = velView.vx;
            const velVY = velView.vy;

            for (let t = 0; t < TICKS; t++) {
                const snap = q.snapshot();
                const refs = snap.refs;
                const count = snap.count;
                for (let i = 0; i < count; i++) {
                    const ref = refs[i]!;
                    posX[ref] = posX[ref]! + velVX[ref]! * DT;
                    posY[ref] = posY[ref]! + velVY[ref]! * DT;
                }
            }
        },
        { iterations: ITER },
    );

    bench(
        'bitECS   query + direct entity-id indexing',
        () => {
            const world = bit.createWorld();
            const Position = {
                x: new Float32Array(N + 1),
                y: new Float32Array(N + 1),
            };
            const Velocity = {
                vx: new Float32Array(N + 1),
                vy: new Float32Array(N + 1),
            };
            for (let i = 0; i < N; i++) {
                const e = bit.addEntity(world);
                bit.addComponent(world, e, Position);
                Position.x[e] = i;
                Position.y[e] = i;
                if (i % 2 === 0) {
                    bit.addComponent(world, e, Velocity);
                    Velocity.vx[e] = 1;
                    Velocity.vy[e] = 0.5;
                }
            }

            for (let t = 0; t < TICKS; t++) {
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
