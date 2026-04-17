/**
 * nvx-ecs vs bitECS — full realistic game-tick simulation.
 *
 * Mirrors a `.io`-style server doing three things per tick:
 *   - Movement   — Position += Velocity × dt  (over ~5k entities)
 *   - Hunger     — Hungry   -= dt             (over ~3.3k entities)
 *   - Decay      — Health   -= dt × 10 if Dead (over ~900 entities)
 *
 * Both worlds do the same math on the same data distribution. nvx-ecs
 * routes through its {@link Scheduler} (with dependency sort, stage
 * ordering, and deferred-destroy flush per tick); bitECS just invokes the
 * three system functions in sequence. The overhead of having a scheduler
 * at all is part of what this benchmark measures.
 */

import { bench, describe } from 'vitest';
import * as bit from 'bitecs';
import { World as NvxWorld } from '../../src/core/world.js';
import { defineComponent } from '../../src/schema/define.js';
import { System } from '../../src/system/system.js';
import type { Query as NvxQuery } from '../../src/query/query.js';
import type { SystemContext } from '../../src/system/types.js';

const N = 10_000;
const TICKS = 100;
const DT = 1 / 30;
const ITER = 10;

// ─── nvx-ecs setup ────────────────────────────────────────────────────────
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
const NvxHungry = defineComponent({
    name: 'Hungry',
    fields: { value: 'f32' },
    storage: 'dense',
});
const NvxHealth = defineComponent({
    name: 'Health',
    fields: { current: 'f32' },
    storage: 'dense',
});
const NvxDead = defineComponent({ name: 'Dead', fields: { at: 'f32' } });

class MovementSys extends System {
    readonly name = 'Movement';
    override readonly reads = [NvxVel];
    override readonly writes = [NvxPos];
    private q!: NvxQuery;

    override init(world: NvxWorld): void {
        this.q = world.query().with(NvxPos, NvxVel).without(NvxDead).build();
    }

    update(world: NvxWorld, ctx: SystemContext): void {
        const pos = world.view(NvxPos);
        const vel = world.view(NvxVel);
        const px = pos.x;
        const py = pos.y;
        const vx = vel.vx;
        const vy = vel.vy;
        const dt = ctx.dt;
        const snap = this.q.snapshot();
        const refs = snap.refs;
        const count = snap.count;
        for (let i = 0; i < count; i++) {
            const ref = refs[i]!;
            px[ref] = px[ref]! + vx[ref]! * dt;
            py[ref] = py[ref]! + vy[ref]! * dt;
        }
    }
}

class HungerSys extends System {
    readonly name = 'Hunger';
    override readonly writes = [NvxHungry];
    private q!: NvxQuery;

    override init(world: NvxWorld): void {
        this.q = world.query().with(NvxHungry).without(NvxDead).build();
    }

    update(world: NvxWorld, ctx: SystemContext): void {
        const hv = world.view(NvxHungry).value;
        const dt = ctx.dt;
        const snap = this.q.snapshot();
        const refs = snap.refs;
        const count = snap.count;
        for (let i = 0; i < count; i++) {
            const ref = refs[i]!;
            hv[ref] = hv[ref]! - dt;
        }
    }
}

class DecaySys extends System {
    readonly name = 'Decay';
    override readonly writes = [NvxHealth];
    private q!: NvxQuery;

    override init(world: NvxWorld): void {
        this.q = world.query().with(NvxHealth, NvxDead).build();
    }

    update(world: NvxWorld, ctx: SystemContext): void {
        const current = world.view(NvxHealth).current;
        const dt = ctx.dt;
        const snap = this.q.snapshot();
        const refs = snap.refs;
        const count = snap.count;
        for (let i = 0; i < count; i++) {
            const ref = refs[i]!;
            current[ref] = current[ref]! - dt * 10;
        }
    }
}

function makeNvxWorld(): NvxWorld {
    const w = new NvxWorld({ initialEntityCapacity: N });
    w.register(NvxPos);
    w.register(NvxVel);
    w.register(NvxHungry);
    w.register(NvxHealth);
    w.register(NvxDead);

    for (let i = 0; i < N; i++) {
        const e = w.createEntity();
        w.add(e, NvxPos, { x: i, y: i });
        if (i % 2 === 0) w.add(e, NvxVel, { vx: 1, vy: 0.5 });
        if (i % 3 === 0) w.add(e, NvxHungry, { value: 100 });
        if (i % 11 === 0) w.add(e, NvxHealth, { current: 50 });
        if (i % 17 === 0) w.add(e, NvxDead, { at: 0 });
    }

    w.registerSystem(new MovementSys());
    w.registerSystem(new HungerSys());
    w.registerSystem(new DecaySys());
    return w;
}

// ─── bitECS setup ─────────────────────────────────────────────────────────
function makeBitWorld() {
    const world = bit.createWorld();
    const Position = { x: new Float32Array(N + 1), y: new Float32Array(N + 1) };
    const Velocity = { vx: new Float32Array(N + 1), vy: new Float32Array(N + 1) };
    const Hungry = { value: new Float32Array(N + 1) };
    const Health = { current: new Float32Array(N + 1) };
    const Dead = { at: new Float32Array(N + 1) };

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
        if (i % 3 === 0) {
            bit.addComponent(world, e, Hungry);
            Hungry.value[e] = 100;
        }
        if (i % 11 === 0) {
            bit.addComponent(world, e, Health);
            Health.current[e] = 50;
        }
        if (i % 17 === 0) {
            bit.addComponent(world, e, Dead);
        }
    }

    return { world, Position, Velocity, Hungry, Health, Dead };
}

describe(`Full server tick — 3 systems × ${N} entities × ${TICKS} ticks`, () => {
    bench(
        'nvx-ecs  world.tick() through Scheduler',
        () => {
            const w = makeNvxWorld();
            for (let t = 0; t < TICKS; t++) w.tick(DT);
        },
        { iterations: ITER },
    );

    bench(
        'bitECS   hand-written system functions',
        () => {
            const { world, Position, Velocity, Hungry, Health, Dead } = makeBitWorld();
            for (let t = 0; t < TICKS; t++) {
                // Movement
                const movers = bit.query(world, [Position, Velocity, bit.Not(Dead)]);
                for (let i = 0; i < movers.length; i++) {
                    const e = movers[i]!;
                    Position.x[e] = Position.x[e]! + Velocity.vx[e]! * DT;
                    Position.y[e] = Position.y[e]! + Velocity.vy[e]! * DT;
                }
                // Hunger
                const hungry = bit.query(world, [Hungry, bit.Not(Dead)]);
                for (let i = 0; i < hungry.length; i++) {
                    const e = hungry[i]!;
                    Hungry.value[e] = Hungry.value[e]! - DT;
                }
                // Decay
                const dying = bit.query(world, [Health, Dead]);
                for (let i = 0; i < dying.length; i++) {
                    const e = dying[i]!;
                    Health.current[e] = Health.current[e]! - DT * 10;
                }
            }
        },
        { iterations: ITER },
    );
});
