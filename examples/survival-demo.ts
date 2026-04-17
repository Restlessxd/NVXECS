/**
 * nvx-ecs — realistic survival `.io` example.
 *
 * Run:
 *   npm run example:survival        (from this package)
 *   npm run example:ecs:survival    (from the repo root)
 *
 * Exercises most of the public surface in a small but realistic scenario:
 *
 *   - 4 components (Position, Velocity, Health, Hungry) with mixed storage.
 *   - 4 systems wired into explicit stages: input / update / postUpdate.
 *   - A DamageEvent channel emitted by one system and consumed by another —
 *     event buffers auto-clear at end of tick.
 *   - Entity destruction (deferred — flushed by the scheduler) with cascade
 *     removal of all components.
 */

import {
    defineComponent,
    defineEvent,
    Query,
    System,
    World,
    type EntityHandle,
    type SystemContext,
} from '../src/index.js';

// ─── Components ───────────────────────────────────────────────────────────
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

const Health = defineComponent({
    name: 'Health',
    fields: { current: 'f32', max: 'f32' },
    storage: 'dense',
});

const Hungry = defineComponent({
    name: 'Hungry',
    fields: { value: 'f32' /* 100 = full, 0 = starving */ },
    storage: 'dense',
});

// ─── Events ───────────────────────────────────────────────────────────────
const DamageEvent = defineEvent({
    name: 'damage',
    fields: { target: 'ref', amount: 'f32', reason: 'u8' },
});

const DEATH_REASON_STARVATION = 1;

// ─── Systems ──────────────────────────────────────────────────────────────

/** Integrates Velocity into Position. Runs in the `update` stage. */
class MovementSystem extends System {
    readonly name = 'Movement';
    override readonly reads = [Velocity];
    override readonly writes = [Position];
    override readonly stage = 'update';

    private q!: Query;

    override init(world: World): void {
        this.q = world.query().with(Position, Velocity).build();
    }

    update(world: World, ctx: SystemContext): void {
        const pos = world.view(Position);
        const vel = world.view(Velocity);
        const snap = this.q.snapshot();
        const dt = ctx.dt;
        for (let i = 0; i < snap.count; i++) {
            const ref = snap.refs[i]!;
            pos.x[ref] = pos.x[ref]! + vel.vx[ref]! * dt;
            pos.y[ref] = pos.y[ref]! + vel.vy[ref]! * dt;
        }
    }
}

/**
 * Drains Hungry by `dt * drainRate`. Emits a DamageEvent when Hungry hits 0
 * (caller-side cascade — the resolver applies the actual HP loss so all
 * damage goes through one auditable channel).
 */
class HungerSystem extends System {
    readonly name = 'Hunger';
    override readonly writes = [Hungry];
    override readonly stage = 'update';

    private q!: Query;
    private readonly drainRate = 5; // hunger points per second

    override init(world: World): void {
        this.q = world.query().with(Hungry).build();
    }

    update(world: World, ctx: SystemContext): void {
        const hungry = world.view(Hungry);
        const snap = this.q.snapshot();
        const dt = ctx.dt;
        const loss = dt * this.drainRate;
        for (let i = 0; i < snap.count; i++) {
            const ref = snap.refs[i]!;
            const v = hungry.value[ref]! - loss;
            hungry.value[ref] = v > 0 ? v : 0;
            if (v <= 0) {
                world.emit(DamageEvent, {
                    target: { ref, gen: world.generationOf(ref) },
                    amount: 2,
                    reason: DEATH_REASON_STARVATION,
                });
            }
        }
    }
}

/**
 * Consumes DamageEvents and applies them to Health. Queues entity destruction
 * when HP hits zero — destruction is deferred to end of tick by the scheduler.
 */
class DamageResolverSystem extends System {
    readonly name = 'DamageResolver';
    override readonly reads = [DamageEvent as never /* reads an event, not a component */];
    override readonly writes = [Health];
    override readonly stage = 'postUpdate';

    update(world: World): void {
        const health = world.view(Health);
        const events = world.readEvents(DamageEvent);
        const targetIdx = events.target.index;
        const targetGen = events.target.generation;
        const amount = events.amount;
        for (let i = 0; i < events.count; i++) {
            const ref = targetIdx[i]!;
            const gen = targetGen[i]!;
            // Handle validation — skip stale refs (entity died earlier this tick).
            if (!world.isAlive({ ref, gen })) continue;
            if (!world.has({ ref, gen }, Health)) continue;

            const hp = health.current[ref]! - amount[i]!;
            health.current[ref] = hp > 0 ? hp : 0;
            if (hp <= 0) {
                world.destroyEntity({ ref, gen });
            }
        }
    }
}

/**
 * Diagnostic system — runs last to print a one-line tick summary. Uses the
 * `network` stage purely for demonstration of stage ordering.
 */
class TelemetrySystem extends System {
    readonly name = 'Telemetry';
    override readonly stage = 'network';

    private q!: Query;

    override init(world: World): void {
        this.q = world.query().with(Hungry).build();
    }

    update(world: World, ctx: SystemContext): void {
        if (ctx.tick % 30 !== 0) return; // once per second @ 30 Hz
        const events = world.readEvents(DamageEvent);
        console.log(
            `  tick ${String(ctx.tick).padStart(3)} │ alive ${world.aliveEntityCount} │ ` +
                `starving ${this.q.count()} │ damage events this tick: ${events.count}`,
        );
    }
}

// ─── Bootstrap ────────────────────────────────────────────────────────────
const world = new World({
    initialEntityCapacity: 128,
    scheduler: { stages: ['input', 'update', 'postUpdate', 'network'] },
});
world.register(Position);
world.register(Velocity);
world.register(Health);
world.register(Hungry);
world.registerEvent(DamageEvent);

world.registerSystem(new MovementSystem());
world.registerSystem(new HungerSystem());
world.registerSystem(new DamageResolverSystem());
world.registerSystem(new TelemetrySystem());

// ─── Spawn 50 entities with varied state ──────────────────────────────────
const spawned: EntityHandle[] = [];
for (let i = 0; i < 50; i++) {
    const e = world.createEntity();
    world.add(e, Position, { x: Math.random() * 100, y: Math.random() * 100 });
    world.add(e, Velocity, {
        vx: (Math.random() - 0.5) * 5,
        vy: (Math.random() - 0.5) * 5,
    });
    world.add(e, Health, { current: 10, max: 10 });
    // Half the population starts hungry enough to starve within a few seconds.
    world.add(e, Hungry, { value: i % 2 === 0 ? 80 : 15 });
    spawned.push(e);
}

// ─── Simulate 6 seconds @ 30 Hz ───────────────────────────────────────────
console.log(
    `Spawned ${spawned.length} entities. Simulating 180 ticks @ 30 Hz (~6 seconds)...\n`,
);
const DT = 1 / 30;
for (let t = 0; t < 180; t++) {
    world.tick(DT);
}

// ─── Report ──────────────────────────────────────────────────────────────
const aliveAfter = world.aliveEntityCount;
const died = spawned.length - aliveAfter;
console.log(
    `\n  ─────────────────────────────\n` +
        `  Final: ${aliveAfter} alive, ${died} starved to death.\n`,
);
