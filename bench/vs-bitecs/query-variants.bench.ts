/**
 * nvx-ecs vs bitECS — query pattern variants.
 *
 * Goes beyond the basic movement benchmark to cover the query shapes
 * real games actually use: single-include fast path, multi-include with
 * exclusion, and many-component joins.
 */

import { bench, describe } from 'vitest';
import * as bit from 'bitecs';
import { World as NvxWorld } from '../../src/core/world.js';
import { defineComponent } from '../../src/schema/define.js';

const N = 10_000;
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
const NvxHealth = defineComponent({
    name: 'Health',
    fields: { value: 'f32' },
    storage: 'dense',
});
const NvxFrozen = defineComponent({
    name: 'Frozen',
    fields: { since: 'f32' },
});
const NvxDead = defineComponent({
    name: 'Dead',
    fields: { at: 'f32' },
});

describe(`Single-include query iteration — ${N} entities × ${TICKS} ticks (Position += 1 per tick)`, () => {
    bench(
        'nvx-ecs  fast path (single include, dense, snapshot)',
        () => {
            const world = new NvxWorld({ initialEntityCapacity: N });
            world.register(NvxPos);
            for (let i = 0; i < N; i++) {
                const e = world.createEntity();
                world.add(e, NvxPos, { x: 0, y: 0 });
            }
            const q = world.query().with(NvxPos).build();
            const pos = world.view(NvxPos);
            const px = pos.x;
            const py = pos.y;

            for (let t = 0; t < TICKS; t++) {
                const snap = q.snapshot();
                const refs = snap.refs;
                const count = snap.count;
                for (let i = 0; i < count; i++) {
                    const ref = refs[i]!;
                    px[ref] = px[ref]! + DT;
                    py[ref] = py[ref]! + DT;
                }
            }
        },
        { iterations: ITER },
    );

    bench(
        'bitECS   single-component query',
        () => {
            const world = bit.createWorld();
            const Position = { x: new Float32Array(N + 1), y: new Float32Array(N + 1) };
            for (let i = 0; i < N; i++) {
                const e = bit.addEntity(world);
                bit.addComponent(world, e, Position);
            }
            for (let t = 0; t < TICKS; t++) {
                const ents = bit.query(world, [Position]);
                for (let i = 0; i < ents.length; i++) {
                    const e = ents[i]!;
                    Position.x[e] = Position.x[e]! + DT;
                    Position.y[e] = Position.y[e]! + DT;
                }
            }
        },
        { iterations: ITER },
    );
});

describe(`Query with exclude — ${N} entities × ${TICKS} ticks (Pos+Vel, !Frozen !Dead)`, () => {
    bench(
        'nvx-ecs  with(Pos,Vel).without(Frozen,Dead)',
        () => {
            const world = new NvxWorld({ initialEntityCapacity: N });
            world.register(NvxPos);
            world.register(NvxVel);
            world.register(NvxFrozen);
            world.register(NvxDead);
            for (let i = 0; i < N; i++) {
                const e = world.createEntity();
                world.add(e, NvxPos, { x: 0, y: 0 });
                if (i % 2 === 0) world.add(e, NvxVel, { vx: 1, vy: 1 });
                if (i % 7 === 0) world.add(e, NvxFrozen, { since: 0 });
                if (i % 11 === 0) world.add(e, NvxDead, { at: 0 });
            }
            const q = world.query().with(NvxPos, NvxVel).without(NvxFrozen, NvxDead).build();
            const pos = world.view(NvxPos);
            const vel = world.view(NvxVel);
            const px = pos.x;
            const py = pos.y;
            const vx = vel.vx;
            const vy = vel.vy;

            for (let t = 0; t < TICKS; t++) {
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
        'bitECS   query(world, [Pos, Vel, Not(Frozen), Not(Dead)])',
        () => {
            const world = bit.createWorld();
            const Position = { x: new Float32Array(N + 1), y: new Float32Array(N + 1) };
            const Velocity = { vx: new Float32Array(N + 1), vy: new Float32Array(N + 1) };
            const Frozen = { since: new Float32Array(N + 1) };
            const Dead = { at: new Float32Array(N + 1) };

            for (let i = 0; i < N; i++) {
                const e = bit.addEntity(world);
                bit.addComponent(world, e, Position);
                if (i % 2 === 0) bit.addComponent(world, e, Velocity);
                if (i % 7 === 0) bit.addComponent(world, e, Frozen);
                if (i % 11 === 0) bit.addComponent(world, e, Dead);
            }

            for (let t = 0; t < TICKS; t++) {
                const ents = bit.query(world, [
                    Position,
                    Velocity,
                    bit.Not(Frozen),
                    bit.Not(Dead),
                ]);
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

describe(`Three-component query — ${N} entities × ${TICKS} ticks (Pos+Vel+Health)`, () => {
    bench(
        'nvx-ecs  with(Pos, Vel, Health)',
        () => {
            const world = new NvxWorld({ initialEntityCapacity: N });
            world.register(NvxPos);
            world.register(NvxVel);
            world.register(NvxHealth);
            for (let i = 0; i < N; i++) {
                const e = world.createEntity();
                world.add(e, NvxPos, { x: 0, y: 0 });
                if (i % 2 === 0) world.add(e, NvxVel, { vx: 1, vy: 1 });
                if (i % 3 === 0) world.add(e, NvxHealth, { value: 100 });
            }
            const q = world.query().with(NvxPos, NvxVel, NvxHealth).build();
            const pos = world.view(NvxPos);
            const vel = world.view(NvxVel);
            const health = world.view(NvxHealth);
            const px = pos.x;
            const py = pos.y;
            const vx = vel.vx;
            const vy = vel.vy;
            const hv = health.value;

            for (let t = 0; t < TICKS; t++) {
                const snap = q.snapshot();
                const refs = snap.refs;
                const count = snap.count;
                for (let i = 0; i < count; i++) {
                    const ref = refs[i]!;
                    px[ref] = px[ref]! + vx[ref]! * DT;
                    py[ref] = py[ref]! + vy[ref]! * DT;
                    hv[ref] = hv[ref]! - DT;
                }
            }
        },
        { iterations: ITER },
    );

    bench(
        'bitECS   query(world, [Pos, Vel, Health])',
        () => {
            const world = bit.createWorld();
            const Position = { x: new Float32Array(N + 1), y: new Float32Array(N + 1) };
            const Velocity = { vx: new Float32Array(N + 1), vy: new Float32Array(N + 1) };
            const Health = { value: new Float32Array(N + 1) };

            for (let i = 0; i < N; i++) {
                const e = bit.addEntity(world);
                bit.addComponent(world, e, Position);
                if (i % 2 === 0) bit.addComponent(world, e, Velocity);
                if (i % 3 === 0) bit.addComponent(world, e, Health);
            }

            for (let t = 0; t < TICKS; t++) {
                const ents = bit.query(world, [Position, Velocity, Health]);
                for (let i = 0; i < ents.length; i++) {
                    const e = ents[i]!;
                    Position.x[e] = Position.x[e]! + Velocity.vx[e]! * DT;
                    Position.y[e] = Position.y[e]! + Velocity.vy[e]! * DT;
                    Health.value[e] = Health.value[e]! - DT;
                }
            }
        },
        { iterations: ITER },
    );
});
