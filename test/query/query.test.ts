import { beforeEach, describe, expect, it } from 'vitest';
import { World } from '../../src/core/world.js';
import { defineComponent } from '../../src/schema/define.js';
import type { EntityHandle } from '../../src/types/index.js';

const Position = defineComponent({ name: 'Position', fields: { x: 'f32', y: 'f32' } });
const Velocity = defineComponent({ name: 'Velocity', fields: { vx: 'f32', vy: 'f32' } });
const Health = defineComponent({ name: 'Health', fields: { current: 'i32' } });
const Frozen = defineComponent({ name: 'Frozen', fields: { since: 'f32' } });
const Dead = defineComponent({ name: 'Dead', fields: { at: 'f32' } });

function makeWorld(): World {
    const w = new World();
    w.register(Position);
    w.register(Velocity);
    w.register(Health);
    w.register(Frozen);
    w.register(Dead);
    return w;
}

describe('Query', () => {
    describe('validation', () => {
        it('throws when built with no include components', () => {
            const w = makeWorld();
            expect(() => w.query().build()).toThrow(/at least one with/);
        });

        it('throws when an unregistered component is used', () => {
            const w = new World();
            w.register(Position);
            const Unregistered = defineComponent({ name: 'Unregistered', fields: { a: 'f32' } });
            expect(() => w.query().with(Position, Unregistered).build()).toThrow(/not registered/);
        });
    });

    describe('fast path: single include, no exclude', () => {
        it('iterates every entity with the component', () => {
            const w = makeWorld();
            const es: EntityHandle[] = [];
            for (let i = 0; i < 10; i++) {
                const e = w.createEntity();
                w.add(e, Position, { x: i, y: i });
                es.push(e);
            }

            const q = w.query().with(Position).build();
            const collected: number[] = [];
            q.forEach((ref) => collected.push(ref));

            expect(collected.length).toBe(10);
            expect(new Set(collected)).toEqual(new Set(es.map((e) => e.ref)));
        });

        it('matches the driver count exactly', () => {
            const w = makeWorld();
            for (let i = 0; i < 7; i++) {
                const e = w.createEntity();
                w.add(e, Position, { x: 0, y: 0 });
            }
            const q = w.query().with(Position).build();
            expect(q.count()).toBe(7);
        });
    });

    describe('multi-include filtering', () => {
        it('returns only entities with every listed component', () => {
            const w = makeWorld();

            // e1: Position only
            const e1 = w.createEntity();
            w.add(e1, Position, { x: 0, y: 0 });

            // e2: Position + Velocity
            const e2 = w.createEntity();
            w.add(e2, Position, { x: 0, y: 0 });
            w.add(e2, Velocity, { vx: 1, vy: 1 });

            // e3: Velocity only
            const e3 = w.createEntity();
            w.add(e3, Velocity, { vx: 1, vy: 1 });

            const q = w.query().with(Position, Velocity).build();
            const out: number[] = [];
            q.collectInto(out);
            expect(out).toEqual([e2.ref]);
        });

        it('picks the smallest-count component as driver', () => {
            const w = makeWorld();
            // 100 entities with Position, 2 with Velocity — driver should be Velocity.
            for (let i = 0; i < 100; i++) {
                const e = w.createEntity();
                w.add(e, Position, { x: 0, y: 0 });
            }
            const a = w.createEntity();
            const b = w.createEntity();
            w.add(a, Position, { x: 0, y: 0 });
            w.add(a, Velocity, { vx: 1, vy: 0 });
            w.add(b, Position, { x: 0, y: 0 });
            w.add(b, Velocity, { vx: 1, vy: 0 });

            const q = w.query().with(Position, Velocity).build();
            expect(q.count()).toBe(2);
        });
    });

    describe('exclude', () => {
        it('filters out entities with any excluded component', () => {
            const w = makeWorld();
            const alive = w.createEntity();
            const dead = w.createEntity();
            const frozen = w.createEntity();

            w.add(alive, Position, { x: 0, y: 0 });
            w.add(dead, Position, { x: 0, y: 0 });
            w.add(dead, Dead, { at: 0 });
            w.add(frozen, Position, { x: 0, y: 0 });
            w.add(frozen, Frozen, { since: 0 });

            const q = w.query().with(Position).without(Dead, Frozen).build();
            const out: number[] = [];
            q.collectInto(out);
            expect(out).toEqual([alive.ref]);
        });

        it('handles exclude alone (without any with)', () => {
            const w = makeWorld();
            // At least one include is required — verified here by inversion:
            expect(() => w.query().without(Dead).build()).toThrow();
        });
    });

    describe('iteration APIs', () => {
        let world: World;

        beforeEach(() => {
            world = makeWorld();
            for (let i = 0; i < 5; i++) {
                const e = world.createEntity();
                world.add(e, Position, { x: i, y: i });
            }
        });

        it('forEach hits every match', () => {
            const q = world.query().with(Position).build();
            let n = 0;
            q.forEach(() => n++);
            expect(n).toBe(5);
        });

        it('collectInto writes into caller array and returns count', () => {
            const q = world.query().with(Position).build();
            const out: number[] = [];
            expect(q.collectInto(out)).toBe(5);
            expect(out.length).toBe(5);
        });

        it('collectInto truncates stale entries when reused', () => {
            const q = world.query().with(Position).build();
            const out: number[] = Array(100).fill(-1);
            expect(q.collectInto(out)).toBe(5);
            expect(out.length).toBe(5);
        });

        it('supports for...of via Symbol.iterator', () => {
            const q = world.query().with(Position).build();
            let n = 0;
            for (const _ of q) n++;
            expect(n).toBe(5);
        });

        it('count() equals forEach-derived count', () => {
            const q = world.query().with(Position).build();
            let fe = 0;
            q.forEach(() => fe++);
            expect(q.count()).toBe(fe);
        });
    });

    describe('reactive to world mutations', () => {
        it('reflects newly added components on subsequent iterations', () => {
            const w = makeWorld();
            const q = w.query().with(Position).build();
            expect(q.count()).toBe(0);

            const e = w.createEntity();
            w.add(e, Position, { x: 0, y: 0 });
            expect(q.count()).toBe(1);
        });

        it('reflects deferred destroys only after flush', () => {
            const w = makeWorld();
            const e = w.createEntity();
            w.add(e, Position, { x: 0, y: 0 });

            const q = w.query().with(Position).build();
            expect(q.count()).toBe(1);

            w.destroyEntity(e);
            // Before flush — still alive to systems running this tick.
            expect(q.count()).toBe(1);
            w.flushPendingDestroys();
            expect(q.count()).toBe(0);
        });

        it('rebuilds masks after a new component is registered past a chunk boundary', () => {
            const w = new World();
            w.register(Position);

            const e = w.createEntity();
            w.add(e, Position, { x: 0, y: 0 });

            const q = w.query().with(Position).build();
            expect(q.count()).toBe(1);

            // Register enough components to trigger bitmask chunk growth (>64 defaults).
            for (let i = 0; i < 70; i++) {
                const c = defineComponent({ name: `C${i}`, fields: { a: 'f32' } });
                w.register(c);
            }

            // Add one of those to e so the bitmask row actually mutates a high chunk.
            const laterComponent = defineComponent({ name: 'Late', fields: { v: 'f32' } });
            w.register(laterComponent);
            w.add(e, laterComponent, { v: 1 });

            // The query should still match — it's still Position-bearing.
            expect(q.count()).toBe(1);
        });
    });

    describe('complex scenarios', () => {
        it('matches the movement pattern (Position + Velocity, no Frozen)', () => {
            const w = makeWorld();

            const makeEntity = (hasPos: boolean, hasVel: boolean, frozen: boolean) => {
                const e = w.createEntity();
                if (hasPos) w.add(e, Position, { x: 0, y: 0 });
                if (hasVel) w.add(e, Velocity, { vx: 1, vy: 0 });
                if (frozen) w.add(e, Frozen, { since: 0 });
                return e;
            };

            const moving = makeEntity(true, true, false); // matches
            /* posOnly   */ makeEntity(true, false, false);
            /* velOnly   */ makeEntity(false, true, false);
            /* frozenBoth */ makeEntity(true, true, true);

            const q = w.query().with(Position, Velocity).without(Frozen).build();
            const out: number[] = [];
            q.collectInto(out);
            expect(out).toEqual([moving.ref]);
        });

        it('stays correct after many random add/remove cycles', () => {
            const w = makeWorld();
            const refs: number[] = [];
            for (let i = 0; i < 50; i++) {
                const e = w.createEntity();
                w.add(e, Position, { x: 0, y: 0 });
                if (i % 2 === 0) w.add(e, Velocity, { vx: 1, vy: 1 });
                refs.push(e.ref);
            }

            // Remove Velocity from a subset
            for (let i = 0; i < 10; i++) {
                w.registry.remove(refs[i]!, Velocity);
            }

            // Expected: Velocity on even-index entities except the first 10 that had it removed.
            const expectedCount = Array.from({ length: 50 }, (_, i) => i).filter(
                (i) => i % 2 === 0 && i >= 10,
            ).length;

            const q = w.query().with(Position, Velocity).build();
            expect(q.count()).toBe(expectedCount);
        });
    });
});
