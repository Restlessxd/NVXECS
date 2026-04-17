import { bench, describe } from 'vitest';
import { EntityStore } from '../src/core/entity.js';
import { World } from '../src/core/world.js';

describe('EntityStore', () => {
    bench(
        'create 10,000 fresh entities',
        () => {
            const store = new EntityStore(16);
            for (let i = 0; i < 10_000; i++) store.create();
        },
        { iterations: 50 },
    );

    bench(
        'create + destroy 10,000 entities (churn with slot reuse)',
        () => {
            const store = new EntityStore(16);
            for (let i = 0; i < 10_000; i++) {
                const h = store.create();
                store.destroy(h);
            }
        },
        { iterations: 50 },
    );

    bench(
        'isAlive check x 100,000',
        () => {
            const store = new EntityStore(16);
            const handles = [];
            for (let i = 0; i < 10_000; i++) handles.push(store.create());
            for (let k = 0; k < 10; k++) {
                for (let i = 0; i < handles.length; i++) {
                    store.isAlive(handles[i]!);
                }
            }
        },
        { iterations: 50 },
    );
});

describe('World entity lifecycle with deferred destroy', () => {
    bench(
        'create 10,000 + flush destroy',
        () => {
            const world = new World();
            const handles = [];
            for (let i = 0; i < 10_000; i++) handles.push(world.createEntity());
            for (const h of handles) world.destroyEntity(h);
            world.flushPendingDestroys();
        },
        { iterations: 50 },
    );
});
