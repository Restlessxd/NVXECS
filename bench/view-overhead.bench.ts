/**
 * Isolated benchmark of `world.view()` call overhead.
 *
 * Before caching: `view()` allocated a new object + re-iterated field specs
 * every call, ~50-150ns + 1 alloc. After caching, it returns a stable
 * reference pinned to the store and mutated in place on growth — should be
 * near-zero overhead regardless of call frequency.
 */

import { bench, describe } from 'vitest';
import { World } from '../src/core/world.js';
import { defineComponent } from '../src/schema/define.js';

const Position = defineComponent({
    name: 'Position',
    fields: { x: 'f32', y: 'f32' },
    storage: 'dense',
});

const CALLS = 1_000_000;

describe(`world.view() call overhead — ${CALLS.toLocaleString()} calls`, () => {
    bench(
        'world.view(Position) × 1M',
        () => {
            const world = new World();
            world.register(Position);
            for (let i = 0; i < CALLS; i++) {
                const v = world.view(Position);
                // Keep the JIT honest: touch one field so the call isn't DCE'd.
                if (v.x.length < 0) throw new Error('impossible');
            }
        },
        { iterations: 10 },
    );
});
