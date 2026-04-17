/**
 * nvx-ecs — basic hello-world example.
 *
 * Run:
 *   npm run example:basic          (from this package)
 *   npm run example:ecs:basic      (from the repo root)
 *
 * Demonstrates the minimum set of steps to stand up a working ECS:
 *   1. Declare components with `defineComponent`
 *   2. Create a subclass of `System` that reads/writes components
 *   3. Register components + systems with a `World`
 *   4. Spawn entities, attach components, and call `world.tick(dt)`
 */

import {
    defineComponent,
    Query,
    System,
    World,
    type SystemContext,
} from '../src/index.js';

// ─── 1. Components ────────────────────────────────────────────────────────
// `storage: 'dense'` is the recommended mode for components held by most
// entities — field arrays are sized to the world's max entity capacity and
// indexed directly by ref, skipping the sparse-set lookup on hot paths.
const Position = defineComponent({
    name: 'Position',
    fields: { x: 'f32', y: 'f32' },
    storage: 'dense',
});

const Velocity = defineComponent({
    name: 'Velocity',
    fields: { vx: 'f32', vy: 'f32' },
    storage: 'dense',
});

// ─── 2. System ────────────────────────────────────────────────────────────
class MovementSystem extends System {
    readonly name = 'Movement';
    override readonly reads = [Velocity];
    override readonly writes = [Position];

    private q!: Query;

    override init(world: World): void {
        // Build the query once at system init and reuse across ticks.
        this.q = world.query().with(Position, Velocity).build();
    }

    update(world: World, ctx: SystemContext): void {
        const pos = world.view(Position);
        const vel = world.view(Velocity);
        // snapshot() returns a reused { refs, count } pair — zero-alloc.
        const snap = this.q.snapshot();
        const dt = ctx.dt;
        for (let i = 0; i < snap.count; i++) {
            const ref = snap.refs[i]!;
            pos.x[ref] = pos.x[ref]! + vel.vx[ref]! * dt;
            pos.y[ref] = pos.y[ref]! + vel.vy[ref]! * dt;
        }
    }
}

// ─── 3. Wire up ───────────────────────────────────────────────────────────
const world = new World({ initialEntityCapacity: 256 });
world.register(Position);
world.register(Velocity);
world.registerSystem(new MovementSystem());

// ─── 4. Spawn 10 entities with random velocity ────────────────────────────
const spawned: ReturnType<typeof world.createEntity>[] = [];
for (let i = 0; i < 10; i++) {
    const e = world.createEntity();
    world.add(e, Position, { x: 0, y: 0 });
    world.add(e, Velocity, {
        vx: (Math.random() - 0.5) * 10,
        vy: (Math.random() - 0.5) * 10,
    });
    spawned.push(e);
}

// ─── 5. Simulate 60 ticks at 30 Hz ────────────────────────────────────────
const DT = 1 / 30;
for (let t = 0; t < 60; t++) {
    world.tick(DT);
}

// ─── 6. Inspect results ───────────────────────────────────────────────────
const pos = world.view(Position);
console.log(`Simulated ${60} ticks at ${1 / DT} Hz over ${spawned.length} entities`);
console.log('\nFinal positions:');
for (const e of spawned) {
    console.log(
        `  entity ${String(e.ref).padStart(2)}  →  (${pos.x[e.ref]!.toFixed(2)}, ${pos.y[
            e.ref
        ]!.toFixed(2)})`,
    );
}
console.log(`\nAlive entities: ${world.aliveEntityCount}`);
