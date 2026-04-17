import { describe, expect, it } from 'vitest';
import { World } from '../../src/core/world.js';
import { defineComponent } from '../../src/schema/define.js';

const Position = defineComponent({
    name: 'Position',
    fields: { x: 'f32', y: 'f32' },
});

const Velocity = defineComponent({
    name: 'Velocity',
    fields: { vx: 'f32', vy: 'f32' },
});

const Health = defineComponent({
    name: 'Health',
    fields: { current: 'i32', max: 'i32' },
});

const Targeting = defineComponent({
    name: 'Targeting',
    fields: { target: 'ref' },
});

describe('World + schema integration', () => {
    describe('basic add / view / mutate', () => {
        it('registers a component and exposes it via view', () => {
            const world = new World();
            world.register(Position);
            const view = world.view(Position);
            expect(view.x).toBeInstanceOf(Float32Array);
            expect(view.y).toBeInstanceOf(Float32Array);
            expect(view.sparseSet.count).toBe(0);
        });

        it('attaches components through add() and reads via view', () => {
            const world = new World();
            world.register(Position);
            const e = world.createEntity();
            world.add(e, Position, { x: 3.5, y: -1.25 });

            expect(world.has(e, Position)).toBe(true);
            const view = world.view(Position);
            const idx = view.sparseSet.indexOf(e.ref);
            expect(view.x[idx]).toBeCloseTo(3.5);
            expect(view.y[idx]).toBeCloseTo(-1.25);
        });

        it('supports multiple components on the same entity', () => {
            const world = new World();
            world.register(Position);
            world.register(Velocity);
            world.register(Health);

            const e = world.createEntity();
            world.add(e, Position, { x: 0, y: 0 });
            world.add(e, Velocity, { vx: 1, vy: 2 });
            world.add(e, Health, { current: 50, max: 100 });

            expect(world.has(e, Position)).toBe(true);
            expect(world.has(e, Velocity)).toBe(true);
            expect(world.has(e, Health)).toBe(true);
        });

        it('remove() returns correct boolean', () => {
            const world = new World();
            world.register(Position);
            const e = world.createEntity();
            expect(world.remove(e, Position)).toBe(false); // not attached
            world.add(e, Position, { x: 0, y: 0 });
            expect(world.remove(e, Position)).toBe(true);
            expect(world.remove(e, Position)).toBe(false); // already gone
        });
    });

    describe('hot-path iteration pattern', () => {
        it('lets a system iterate a component via sparseSet.dense', () => {
            const world = new World();
            world.register(Position);

            // Spawn 5 entities
            const entities = [];
            for (let i = 0; i < 5; i++) {
                const e = world.createEntity();
                world.add(e, Position, { x: i * 10, y: i * 20 });
                entities.push(e);
            }

            // System: double every position
            const { sparseSet, x, y } = world.view(Position);
            for (let i = 0; i < sparseSet.count; i++) {
                x[i] = x[i]! * 2;
                y[i] = y[i]! * 2;
            }

            // Verify
            const view = world.view(Position);
            for (const e of entities) {
                const idx = view.sparseSet.indexOf(e.ref);
                expect(view.x[idx]).toBeCloseTo((idx * 10 * 2) / 1); // sparse order may differ
            }
        });
    });

    describe('destroy cascades through components', () => {
        it('removes all components when entity is destroyed', () => {
            const world = new World();
            world.register(Position);
            world.register(Velocity);
            world.register(Health);

            const e = world.createEntity();
            world.add(e, Position, { x: 1, y: 2 });
            world.add(e, Velocity, { vx: 3, vy: 4 });
            world.add(e, Health, { current: 5, max: 10 });

            expect(world.view(Position).sparseSet.count).toBe(1);
            expect(world.view(Velocity).sparseSet.count).toBe(1);
            expect(world.view(Health).sparseSet.count).toBe(1);

            world.destroyEntity(e);
            world.flushPendingDestroys();

            expect(world.view(Position).sparseSet.count).toBe(0);
            expect(world.view(Velocity).sparseSet.count).toBe(0);
            expect(world.view(Health).sparseSet.count).toBe(0);
        });

        it('within a tick, destroyed entity still shows in components (deferred)', () => {
            const world = new World();
            world.register(Position);
            const e = world.createEntity();
            world.add(e, Position, { x: 1, y: 2 });
            world.destroyEntity(e);

            // Before flush — still visible to systems running this tick.
            expect(world.view(Position).sparseSet.count).toBe(1);
            expect(world.has(e, Position)).toBe(true);

            world.flushPendingDestroys();
            expect(world.view(Position).sparseSet.count).toBe(0);
        });

        it('does not crash on destroy of entity with no components', () => {
            const world = new World();
            const e = world.createEntity();
            world.destroyEntity(e);
            expect(() => world.flushPendingDestroys()).not.toThrow();
        });

        it('cleanly reuses slots across entity lifetime', () => {
            const world = new World();
            world.register(Position);

            const first = world.createEntity();
            world.add(first, Position, { x: 1, y: 1 });
            world.destroyEntity(first);
            world.flushPendingDestroys();

            const second = world.createEntity();
            expect(second.ref).toBe(first.ref); // slot reused
            expect(world.has(second, Position)).toBe(false); // cleanly reset
        });
    });

    describe('ref fields with EntityHandle', () => {
        it('stores and reads a handle via a ref field', () => {
            const world = new World();
            world.register(Targeting);

            const shooter = world.createEntity();
            const target = world.createEntity();

            world.add(shooter, Targeting, { target });
            const view = world.view(Targeting);
            const idx = view.sparseSet.indexOf(shooter.ref);
            expect(view.target.index[idx]).toBe(target.ref);
            expect(view.target.generation[idx]).toBe(target.gen);
        });
    });
});
