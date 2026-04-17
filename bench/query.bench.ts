import { bench, describe } from 'vitest';
import { World } from '../src/core/world.js';
import { defineComponent } from '../src/schema/define.js';

const Position = defineComponent({ name: 'Position', fields: { x: 'f32', y: 'f32' } });
const Velocity = defineComponent({ name: 'Velocity', fields: { vx: 'f32', vy: 'f32' } });
const Health = defineComponent({ name: 'Health', fields: { current: 'i32' } });
const Frozen = defineComponent({ name: 'Frozen', fields: { since: 'f32' } });
const Dead = defineComponent({ name: 'Dead', fields: { at: 'f32' } });

const ENTITY_COUNT = 10_000;

function makeWorld(): World {
    const w = new World({ initialEntityCapacity: ENTITY_COUNT });
    w.register(Position);
    w.register(Velocity);
    w.register(Health);
    w.register(Frozen);
    w.register(Dead);

    for (let i = 0; i < ENTITY_COUNT; i++) {
        const e = w.createEntity();
        w.add(e, Position, { x: i, y: i });
        if (i % 2 === 0) w.add(e, Velocity, { vx: 1, vy: 1 });
        if (i % 3 === 0) w.add(e, Health, { current: 100 });
        if (i % 7 === 0) w.add(e, Frozen, { since: 0 });
        if (i % 11 === 0) w.add(e, Dead, { at: 0 });
    }
    return w;
}

describe('Query iteration (10,000 entities)', () => {
    bench(
        'fast path: single include, no exclude (Position — all 10k)',
        () => {
            const w = makeWorld();
            const q = w.query().with(Position).build();
            let n = 0;
            q.forEach(() => n++);
            if (n < 0) throw new Error('impossible');
        },
        { iterations: 20 },
    );

    bench(
        'multi-include: Position + Velocity',
        () => {
            const w = makeWorld();
            const q = w.query().with(Position, Velocity).build();
            let n = 0;
            q.forEach(() => n++);
            if (n < 0) throw new Error('impossible');
        },
        { iterations: 20 },
    );

    bench(
        'multi-include + exclude: Position + Velocity !Frozen !Dead',
        () => {
            const w = makeWorld();
            const q = w.query().with(Position, Velocity).without(Frozen, Dead).build();
            let n = 0;
            q.forEach(() => n++);
            if (n < 0) throw new Error('impossible');
        },
        { iterations: 20 },
    );

    bench(
        'reused query across 100 ticks (fast path)',
        () => {
            const w = makeWorld();
            const q = w.query().with(Position).build();
            const posView = w.view(Position);
            let total = 0;
            for (let tick = 0; tick < 100; tick++) {
                q.forEach((ref) => {
                    const i = posView.sparseSet.indexOf(ref);
                    total += posView.x[i]!;
                });
            }
            if (total < 0) throw new Error('impossible');
        },
        { iterations: 10 },
    );

    bench(
        'collectInto + manual loop (100 ticks)',
        () => {
            const w = makeWorld();
            const q = w.query().with(Position, Velocity).build();
            const posView = w.view(Position);
            const velView = w.view(Velocity);
            const matches: number[] = [];
            for (let tick = 0; tick < 100; tick++) {
                const n = q.collectInto(matches);
                for (let i = 0; i < n; i++) {
                    const ref = matches[i]!;
                    const pi = posView.sparseSet.indexOf(ref);
                    const vi = velView.sparseSet.indexOf(ref);
                    posView.x[pi] = posView.x[pi]! + velView.vx[vi]!;
                    posView.y[pi] = posView.y[pi]! + velView.vy[vi]!;
                }
            }
        },
        { iterations: 10 },
    );
});
