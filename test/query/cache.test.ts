import { describe, expect, it } from 'vitest';
import { World } from '../../src/core/world.js';
import { defineComponent } from '../../src/schema/define.js';

const Position = defineComponent({ name: 'Position', fields: { x: 'f32', y: 'f32' } });
const Velocity = defineComponent({ name: 'Velocity', fields: { vx: 'f32', vy: 'f32' } });
const Frozen = defineComponent({ name: 'Frozen', fields: { since: 'f32' } });

function setup(): World {
    const w = new World();
    w.register(Position);
    w.register(Velocity);
    w.register(Frozen);
    return w;
}

describe('Query cache', () => {
    it('caches matches across calls when no structural changes occur', () => {
        const w = setup();
        for (let i = 0; i < 5; i++) {
            const e = w.createEntity();
            w.add(e, Position, { x: 0, y: 0 });
            w.add(e, Velocity, { vx: 1, vy: 1 });
        }
        const q = w.query().with(Position, Velocity).build();

        const firstCount = q.count();
        expect(firstCount).toBe(5);

        // Subsequent calls should return the exact same cached Uint32Array
        // (no rebuild, no new allocation).
        const refs1 = q.cachedRefs();
        const refs2 = q.cachedRefs();
        expect(refs1).toBe(refs2);
    });

    it('fast-path query exposes the driver dense directly as cache', () => {
        const w = setup();
        const e = w.createEntity();
        w.add(e, Position, { x: 0, y: 0 });

        const q = w.query().with(Position).build();
        const refs = q.cachedRefs();

        // In fast-path mode the cache is the driver store's dense array —
        // zero-copy.
        const store = w.registry.storeOf(Position);
        expect(refs).toBe(store.sparseSet.dense);
    });

    it('rebuilds cache after an add() invalidates versions', () => {
        const w = setup();
        const q = w.query().with(Position, Velocity).build();

        expect(q.count()).toBe(0);

        const e = w.createEntity();
        w.add(e, Position, { x: 0, y: 0 });
        w.add(e, Velocity, { vx: 0, vy: 0 });

        // New entity added — cache must rebuild
        expect(q.count()).toBe(1);
    });

    it('rebuilds cache after a remove() invalidates versions', () => {
        const w = setup();
        const a = w.createEntity();
        const b = w.createEntity();
        w.add(a, Position, { x: 0, y: 0 });
        w.add(a, Velocity, { vx: 0, vy: 0 });
        w.add(b, Position, { x: 0, y: 0 });
        w.add(b, Velocity, { vx: 0, vy: 0 });

        const q = w.query().with(Position, Velocity).build();
        expect(q.count()).toBe(2);

        w.remove(a, Velocity);
        expect(q.count()).toBe(1);
    });

    it('rebuilds after deferred destroy flush', () => {
        const w = setup();
        const e = w.createEntity();
        w.add(e, Position, { x: 0, y: 0 });
        w.add(e, Velocity, { vx: 0, vy: 0 });

        const q = w.query().with(Position, Velocity).build();
        expect(q.count()).toBe(1);

        w.destroyEntity(e);
        // Before flush the entity still exists — cache is still valid.
        expect(q.count()).toBe(1);
        w.flushPendingDestroys();
        // Flush removes components → structural version bumps → cache rebuilt.
        expect(q.count()).toBe(0);
    });

    it('exclude-component changes invalidate the cache', () => {
        const w = setup();
        const a = w.createEntity();
        const b = w.createEntity();
        w.add(a, Position, { x: 0, y: 0 });
        w.add(a, Velocity, { vx: 0, vy: 0 });
        w.add(b, Position, { x: 0, y: 0 });
        w.add(b, Velocity, { vx: 0, vy: 0 });

        const q = w.query().with(Position, Velocity).without(Frozen).build();
        expect(q.count()).toBe(2);

        // Adding Frozen to 'a' should exclude it from the query.
        w.add(a, Frozen, { since: 0 });
        expect(q.count()).toBe(1);

        w.remove(a, Frozen);
        expect(q.count()).toBe(2);
    });

    it('forEach walks the cached list', () => {
        const w = setup();
        const refs: number[] = [];
        for (let i = 0; i < 10; i++) {
            const e = w.createEntity();
            w.add(e, Position, { x: i, y: 0 });
            if (i % 2 === 0) {
                w.add(e, Velocity, { vx: 0, vy: 0 });
                refs.push(e.ref);
            }
        }

        const q = w.query().with(Position, Velocity).build();
        const seen: number[] = [];
        q.forEach((r) => seen.push(r));
        expect(new Set(seen)).toEqual(new Set(refs));
    });

    it('stays correct after repeated add/remove cycles', () => {
        const w = setup();
        const e = w.createEntity();
        const q = w.query().with(Position).build();

        expect(q.count()).toBe(0);
        w.add(e, Position, { x: 0, y: 0 });
        expect(q.count()).toBe(1);
        w.remove(e, Position);
        expect(q.count()).toBe(0);
        w.add(e, Position, { x: 0, y: 0 });
        expect(q.count()).toBe(1);
    });
});
