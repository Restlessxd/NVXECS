import { describe, expect, it } from 'vitest';
import { World } from '../../src/core/world.js';

describe('World', () => {
    describe('entity lifecycle', () => {
        it('creates entities through the store', () => {
            const world = new World();
            const a = world.createEntity();
            const b = world.createEntity();
            expect(a.ref).toBe(0);
            expect(b.ref).toBe(1);
            expect(world.aliveEntityCount).toBe(2);
        });

        it('isAlive reflects the current state', () => {
            const world = new World();
            const h = world.createEntity();
            expect(world.isAlive(h)).toBe(true);
        });
    });

    describe('deferred destruction', () => {
        it('keeps entities alive until flushPendingDestroys', () => {
            const world = new World();
            const h = world.createEntity();
            world.destroyEntity(h);
            // Before flush — still alive, systems mid-tick can observe it.
            expect(world.isAlive(h)).toBe(true);
            expect(world.pendingDestroyCount).toBe(1);
            expect(world.aliveEntityCount).toBe(1);

            const destroyed = world.flushPendingDestroys();
            expect(destroyed).toBe(1);
            expect(world.isAlive(h)).toBe(false);
            expect(world.aliveEntityCount).toBe(0);
            expect(world.pendingDestroyCount).toBe(0);
        });

        it('handles duplicate destroy requests idempotently', () => {
            const world = new World();
            const h = world.createEntity();
            world.destroyEntity(h);
            world.destroyEntity(h);
            world.destroyEntity(h);
            expect(world.pendingDestroyCount).toBe(3);

            const destroyed = world.flushPendingDestroys();
            // First entry destroys; subsequent ones find stale gen and no-op.
            expect(destroyed).toBe(1);
            expect(world.aliveEntityCount).toBe(0);
        });

        it('grows the pending-destroy buffer past its initial size', () => {
            const world = new World();
            const handles = [];
            for (let i = 0; i < 200; i++) handles.push(world.createEntity());
            for (const h of handles) world.destroyEntity(h);
            expect(world.pendingDestroyCount).toBe(200);

            const destroyed = world.flushPendingDestroys();
            expect(destroyed).toBe(200);
            expect(world.aliveEntityCount).toBe(0);
        });

        it('stale handles queued for destroy silently skip during flush', () => {
            const world = new World();
            const a = world.createEntity();
            world.destroyEntity(a);
            world.flushPendingDestroys(); // a is now dead

            // Queue the same (now stale) handle again on the next tick
            world.destroyEntity(a);
            const destroyed = world.flushPendingDestroys();
            expect(destroyed).toBe(0);
        });
    });

    describe('slot reuse preserves semantics across ticks', () => {
        it('stale handle across a destroy+create is detected', () => {
            const world = new World();
            const first = world.createEntity();
            world.destroyEntity(first);
            world.flushPendingDestroys();

            const second = world.createEntity();
            expect(second.ref).toBe(first.ref); // slot reused
            expect(world.isAlive(first)).toBe(false);
            expect(world.isAlive(second)).toBe(true);
        });
    });
});
