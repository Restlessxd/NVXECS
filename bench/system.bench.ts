/**
 * Realistic workload benchmarks.
 *
 * Simulates a .io-style server tick:
 *   - ~10,000 entities
 *   - MovementSystem:   Position += Velocity * dt   (over ~5,000 entities)
 *   - HungerSystem:     Hungry -= dt               (over ~3,000 entities)
 *   - HealthDecaySystem: Health -= dt if Dead      (over ~900 entities)
 *
 * Measures full-tick throughput across 100 ticks.
 */

import { bench, describe } from 'vitest';
import { World } from '../src/core/world.js';
import { defineComponent } from '../src/schema/define.js';
import { System } from '../src/system/system.js';
import type { Query } from '../src/query/query.js';
import type { SystemContext } from '../src/system/types.js';

const Position = defineComponent({ name: 'Position', fields: { x: 'f32', y: 'f32' } });
const Velocity = defineComponent({ name: 'Velocity', fields: { vx: 'f32', vy: 'f32' } });
const Hungry = defineComponent({ name: 'Hungry', fields: { value: 'f32' } });
const Health = defineComponent({ name: 'Health', fields: { current: 'f32' } });
const Dead = defineComponent({ name: 'Dead', fields: { at: 'f32' } });

const ENTITY_COUNT = 10_000;
const TICKS = 100;

class MovementSystem extends System {
    readonly name = 'Movement';
    override readonly reads = [Velocity];
    override readonly writes = [Position];
    private q!: Query;

    override init(world: World): void {
        this.q = world.query().with(Position, Velocity).without(Dead).build();
    }

    update(world: World, ctx: SystemContext): void {
        const pos = world.view(Position);
        const vel = world.view(Velocity);
        const posX = pos.x;
        const posY = pos.y;
        const velVX = vel.vx;
        const velVY = vel.vy;
        const dt = ctx.dt;
        const posSparse = pos.sparseSet.sparse;
        const velSparse = vel.sparseSet.sparse;

        this.q.forEach((ref) => {
            const pi = posSparse[ref]!;
            const vi = velSparse[ref]!;
            posX[pi] = posX[pi]! + velVX[vi]! * dt;
            posY[pi] = posY[pi]! + velVY[vi]! * dt;
        });
    }
}

class HungerSystem extends System {
    readonly name = 'Hunger';
    override readonly writes = [Hungry];
    private q!: Query;

    override init(world: World): void {
        this.q = world.query().with(Hungry).without(Dead).build();
    }

    update(world: World, ctx: SystemContext): void {
        const hungerView = world.view(Hungry);
        const dt = ctx.dt;
        // Fast path: iterate driver dense directly
        const dense = hungerView.sparseSet.dense;
        const count = hungerView.sparseSet.count;
        const value = hungerView.value;
        // Single-include, no exclude is the fast path — just iterate all.
        // To honour the exclude we still go through forEach.
        this.q.forEach((ref) => {
            const i = hungerView.sparseSet.sparse[ref]!;
            value[i] = value[i]! - dt;
        });
        if (count < 0) throw new Error('impossible: ' + dense.length);
    }
}

class HealthDecaySystem extends System {
    readonly name = 'HealthDecay';
    override readonly writes = [Health];
    private q!: Query;

    override init(world: World): void {
        this.q = world.query().with(Health, Dead).build();
    }

    update(world: World, ctx: SystemContext): void {
        const healthView = world.view(Health);
        const dt = ctx.dt;
        const sparse = healthView.sparseSet.sparse;
        const current = healthView.current;
        this.q.forEach((ref) => {
            const i = sparse[ref]!;
            current[i] = current[i]! - dt * 10;
        });
    }
}

function makeWorld(): World {
    const w = new World({ initialEntityCapacity: ENTITY_COUNT });
    w.register(Position);
    w.register(Velocity);
    w.register(Hungry);
    w.register(Health);
    w.register(Dead);

    for (let i = 0; i < ENTITY_COUNT; i++) {
        const e = w.createEntity();
        w.add(e, Position, { x: i, y: i });
        if (i % 2 === 0) w.add(e, Velocity, { vx: 1, vy: 0.5 });
        if (i % 3 === 0) w.add(e, Hungry, { value: 100 });
        if (i % 11 === 0) w.add(e, Health, { current: 50 });
        if (i % 17 === 0) w.add(e, Dead, { at: 0 });
    }

    w.registerSystem(new MovementSystem());
    w.registerSystem(new HungerSystem());
    w.registerSystem(new HealthDecaySystem());
    return w;
}

describe('Realistic workload', () => {
    bench(
        `world.tick() x ${TICKS} with 3 systems over ${ENTITY_COUNT} entities`,
        () => {
            const w = makeWorld();
            for (let t = 0; t < TICKS; t++) w.tick(1 / 30);
        },
        { iterations: 10 },
    );

    bench(
        `MovementSystem alone x ${TICKS} ticks`,
        () => {
            const w = new World({ initialEntityCapacity: ENTITY_COUNT });
            w.register(Position);
            w.register(Velocity);
            w.register(Dead);
            for (let i = 0; i < ENTITY_COUNT; i++) {
                const e = w.createEntity();
                w.add(e, Position, { x: i, y: i });
                w.add(e, Velocity, { vx: 1, vy: 0.5 });
            }
            w.registerSystem(new MovementSystem());
            for (let t = 0; t < TICKS; t++) w.tick(1 / 30);
        },
        { iterations: 10 },
    );
});
