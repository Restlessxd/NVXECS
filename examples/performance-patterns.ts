/**
 * nvx-ecs — performance patterns demo.
 *
 * Run:
 *   npm run example:perf           (from this package)
 *   npm run example:ecs:perf       (from the repo root)
 *
 * Showcases the opt-in fast paths that let nvx-ecs beat bitECS on realistic
 * workloads while keeping type-safety and the scheduler/event/hot-reload
 * features on top.
 *
 * Each pattern runs a microbenchmark and prints the elapsed time so you can
 * compare them on your own hardware. Total run is under a second.
 */

import {
    defineComponent,
    World,
    type ComponentInfo,
    type EntityRef,
} from '../src/index.js';

const N = 10_000;
const TICKS = 100;
const DT = 1 / 30;

function bench(label: string, fn: () => void): void {
    // Single warmup run so V8 optimizes before we measure.
    fn();
    const start = performance.now();
    fn();
    const elapsed = performance.now() - start;
    console.log(`  ${label.padEnd(54)}  ${elapsed.toFixed(2).padStart(7)} ms`);
}

// ─── Pattern 1: dense storage for hot components ──────────────────────────
console.log('\n── Pattern 1: dense vs sparse storage ──');

const SparsePos = defineComponent({
    name: 'SparsePos',
    fields: { x: 'f32', y: 'f32' },
    // storage: 'sparse' is the default — memory scales with population.
});

const DensePos = defineComponent({
    name: 'DensePos',
    fields: { x: 'f32', y: 'f32' },
    storage: 'dense', // memory scales with max entity capacity, faster access
});

bench(`sparse: ${N} attach via world.add + init`, () => {
    const w = new World({ initialEntityCapacity: N });
    w.register(SparsePos);
    for (let i = 0; i < N; i++) {
        const e = w.createEntity();
        w.add(e, SparsePos, { x: i, y: i });
    }
});

bench(`dense:  ${N} attach via world.add + init`, () => {
    const w = new World({ initialEntityCapacity: N });
    w.register(DensePos);
    for (let i = 0; i < N; i++) {
        const e = w.createEntity();
        w.add(e, DensePos, { x: i, y: i });
    }
});

// ─── Pattern 2: attachEmpty + direct field write ──────────────────────────
console.log('\n── Pattern 2: attach fast-path for spawn loops ──');

bench(`dense:  ${N} attach via attachEmpty + direct write`, () => {
    const w = new World({ initialEntityCapacity: N });
    w.register(DensePos);
    const view = w.view(DensePos);
    const x = view.x;
    const y = view.y;
    for (let i = 0; i < N; i++) {
        const e = w.createEntity();
        const idx = w.attachEmpty(e, DensePos);
        x[idx] = i;
        y[idx] = i;
    }
});

// ─── Pattern 3: snapshot()-based iteration ────────────────────────────────
console.log(`\n── Pattern 3: query iteration patterns (${TICKS} ticks × ${N} entities) ──`);

const Velocity = defineComponent({
    name: 'Velocity',
    fields: { vx: 'f32', vy: 'f32' },
    storage: 'dense',
});

function makeIterWorld(): World {
    const w = new World({ initialEntityCapacity: N });
    w.register(DensePos);
    w.register(Velocity);
    for (let i = 0; i < N; i++) {
        const e = w.createEntity();
        w.add(e, DensePos, { x: i, y: i });
        if (i % 2 === 0) w.add(e, Velocity, { vx: 1, vy: 0.5 });
    }
    return w;
}

bench('forEach callback', () => {
    const w = makeIterWorld();
    const q = w.query().with(DensePos, Velocity).build();
    const pos = w.view(DensePos);
    const vel = w.view(Velocity);
    for (let t = 0; t < TICKS; t++) {
        q.forEach((ref) => {
            pos.x[ref] = pos.x[ref]! + vel.vx[ref]! * DT;
            pos.y[ref] = pos.y[ref]! + vel.vy[ref]! * DT;
        });
    }
});

bench('snapshot() + plain for loop', () => {
    const w = makeIterWorld();
    const q = w.query().with(DensePos, Velocity).build();
    const pos = w.view(DensePos);
    const vel = w.view(Velocity);
    const px = pos.x;
    const py = pos.y;
    const vx = vel.vx;
    const vy = vel.vy;
    for (let t = 0; t < TICKS; t++) {
        const snap = q.snapshot();
        const refs = snap.refs;
        const count = snap.count;
        for (let i = 0; i < count; i++) {
            const ref = refs[i]!;
            px[ref] = px[ref]! + vx[ref]! * DT;
            py[ref] = py[ref]! + vy[ref]! * DT;
        }
    }
});

// ─── Pattern 4: hasByInfo pre-resolved membership probe ───────────────────
console.log('\n── Pattern 4: membership-check fast paths ──');

const Dead = defineComponent({ name: 'Dead', fields: { at: 'f32' } });

function makeMembershipWorld(): { world: World; refs: EntityRef[] } {
    const w = new World({ initialEntityCapacity: N });
    w.register(DensePos);
    w.register(Dead);
    const refs: EntityRef[] = new Array(N);
    for (let i = 0; i < N; i++) {
        const e = w.createEntity();
        w.add(e, DensePos, { x: 0, y: 0 });
        // Mark half the population as Dead.
        if (i % 2 === 0) w.add(e, Dead, { at: 0 });
        refs[i] = e.ref;
    }
    return { world: w, refs };
}

bench(`${N} × world.has(handle, def)`, () => {
    const { world, refs } = makeMembershipWorld();
    const handles = refs.map((r) => ({ ref: r, gen: world.generationOf(r) }));
    let count = 0;
    for (let i = 0; i < handles.length; i++) {
        if (world.has(handles[i]!, Dead)) count++;
    }
    if (count !== N / 2) throw new Error('invariant failed');
});

bench(`${N} × world.hasById(ref, def)`, () => {
    const { world, refs } = makeMembershipWorld();
    let count = 0;
    for (let i = 0; i < refs.length; i++) {
        if (world.hasById(refs[i]!, Dead)) count++;
    }
    if (count !== N / 2) throw new Error('invariant failed');
});

bench(`${N} × world.hasByInfo(ref, info) — pre-resolved`, () => {
    const { world, refs } = makeMembershipWorld();
    const deadInfo: ComponentInfo = world.infoOf(Dead)!;
    let count = 0;
    for (let i = 0; i < refs.length; i++) {
        if (world.hasByInfo(refs[i]!, deadInfo)) count++;
    }
    if (count !== N / 2) throw new Error('invariant failed');
});

console.log('\n── Takeaways ──');
console.log('  • Use `storage: "dense"` on components held by most entities');
console.log('  • Use `attachEmpty` + direct field writes in hot spawn loops');
console.log('  • Use `query.snapshot()` + plain `for` loops in system `update`');
console.log('  • Resolve ComponentInfo once for per-entity membership probes');
console.log('  • Keep `storage: "sparse"` for niche components to save memory\n');
