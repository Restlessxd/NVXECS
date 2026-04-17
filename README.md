# NVX-ECS

**The fastest general-purpose ECS for Node.js game servers.**

A sparse-set + opt-in-dense Entity Component System with a dependency-based scheduler, event bus, hot reload, and TypeScript-native type inference — benchmarked head-to-head against [bitECS](https://github.com/NateTheGreatt/bitECS) on **12 identical workloads** and winning all twelve, from **1.7× to 30× faster**.

Made with [@Claude](https://github.com/anthropics/claude-code) and Love ❤️

[![Tests](https://img.shields.io/badge/tests-189%2F189_passing-brightgreen)]() [![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6?logo=typescript&logoColor=white)]() [![License](https://img.shields.io/badge/license-MIT-blue)](LICENSE) [![Zero deps](https://img.shields.io/badge/runtime_deps-0-success)]() [![Node](https://img.shields.io/badge/node-%E2%89%A522-brightgreen?logo=node.js&logoColor=white)]()

```
┌──────────────────────────── vs bitECS (100 ticks × 10k entities) ───────────────────────────┐
│                                                                                             │
│  Entity churn           ████████████████████████████████████████████████████████  30.2×    │
│  Fresh entity create    ████████████████████████████████                          15.3×    │
│  World lifecycle        ██████████████                                             5.1×    │
│  Remove component       █████████                                                  3.2×    │
│  hasComponent           █████████                                                  3.0×    │
│  Component attach       ████████                                                   2.8×    │
│  Three-component query  ████████                                                   2.7×    │
│  Movement query         ███████                                                    2.2×    │
│  Full server tick       ███████                                                    2.1×    │
│  Query with exclude     ██████                                                     1.9×    │
│  Single-include query   ██████                                                     1.9×    │
│  Structural churn       ██████                                                     1.9×    │
│  world.add (with init)  █████                                                      1.7×    │
│                                                                                             │
│                    12 wins · 0 ties · 0 losses. Clean sweep.                                │
└─────────────────────────────────────────────────────────────────────────────────────────────┘
```

See [docs/PERFORMANCE.md](docs/PERFORMANCE.md) for full methodology, per-benchmark tables, and the seven-phase optimization log.

---

## Why nvx-ecs

ECS libraries for JS/TS have lived in two camps: fast-but-untyped (bitECS), and typed-but-slow (most others). `nvx-ecs` is aggressively both:

- **Faster than the fastest** — beats bitECS on every realistic workload, including full tick simulation with a scheduler, event bus, and cascade destroy that bitECS doesn't have.
- **Full TypeScript inference** — `world.view(Position).x` is typed as `Float32Array`, `.alive` as `Uint8Array`, `.target` as `{ index, generation }`. No generics, no manual typing.
- **Zero runtime dependencies.** Ship it next to your game server without bloat.
- **Memory grows with usage**, not with world capacity. Sparse mode (default) allocates per-component population; dense mode is opt-in for hot components.

## Quick start

```ts
import { World, defineComponent, System, Query, type SystemContext } from 'nvx-ecs';

// 1. Declare components
const Position = defineComponent({
    name: 'Position',
    fields: { x: 'f32', y: 'f32' },
    storage: 'dense',          // opt-in: held by most entities
});

const Velocity = defineComponent({
    name: 'Velocity',
    fields: { vx: 'f32', vy: 'f32' },
    storage: 'dense',
});

// 2. Write a system
class MovementSystem extends System {
    readonly name = 'Movement';
    override readonly reads  = [Velocity];
    override readonly writes = [Position];

    private q!: Query;

    override init(world: World) {
        this.q = world.query().with(Position, Velocity).build();
    }

    update(world: World, ctx: SystemContext) {
        const pos = world.view(Position);   // typed view
        const vel = world.view(Velocity);
        const snap = this.q.snapshot();      // zero-alloc { refs, count }
        for (let i = 0; i < snap.count; i++) {
            const ref = snap.refs[i]!;
            pos.x[ref] += vel.vx[ref] * ctx.dt;
            pos.y[ref] += vel.vy[ref] * ctx.dt;
        }
    }
}

// 3. Wire up and tick
const world = new World({ initialEntityCapacity: 10_000 });
world.register(Position);
world.register(Velocity);
world.registerSystem(new MovementSystem());

for (let i = 0; i < 100; i++) {
    const e = world.createEntity();
    world.add(e, Position, { x: 0, y: 0 });
    world.add(e, Velocity, { vx: Math.random(), vy: Math.random() });
}

setInterval(() => world.tick(1 / 30), 1000 / 30);
```

More examples: [`examples/basic.ts`](examples/basic.ts), [`examples/survival-demo.ts`](examples/survival-demo.ts), [`examples/performance-patterns.ts`](examples/performance-patterns.ts).

## Features

- **Entity lifecycle** — 32-bit generation counters make stale-ref detection free; free-list + deferred destroy with automatic component cascade.
- **Dual storage** — `sparse` (default, memory ∝ population) or `dense` (memory ∝ capacity, faster access) per-component.
- **Queries** — `with(...)`, `without(...)`, cached match list invalidated lazily via per-store `structuralVersion`. `snapshot()` returns a reused `{ refs, count }` pair.
- **Scheduler** — dependency-based via `reads` / `writes` declarations, topological sort with cycle detection, stages (`input`, `update`, `postUpdate`, `network`, …).
- **Hot reload** — `world.replaceSystem(name, next)` swaps logic in place without losing world state.
- **Events** — `defineEvent` with the same field vocabulary, per-tick auto-clear, multi-read fan-out.
- **TypeScript strict** — `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`.

## What makes it fast

Seven backward-compatible optimization phases, each measurable:

1. **Dense storage mode** — opt-in, skips sparse-set indirection.
2. **Query match cache** — `structuralVersion` invalidation, lazy rebuild, zero-alloc `snapshot()`.
3. **`attachEmpty` fast-path** — attach without init-object dispatch.
4. **Precomputed `ComponentInfo`** — `{ generationId, bitflag }` cached so `has` paths skip shifts.
5. **Cached component views** — `world.view(def)` returns the same object every call, mutated in place on growth.
6. **Zero-alloc** - GC pressure and reduces cascade destroy from `O(N_components)` to `O(K_attached)`.

## Install

This package is part of a monorepo and isn't published to npm yet. To vendor it into your project:

```bash
git clone https://github.com/<owner>/<repo>.git
# or drop global-libraries/nvx-ecs/ into your tree
```

Scripts (from the package root):

```bash
npm run build           # esbuild → dist/nvx-ecs.{esm,cjs}.js
npm run test            # vitest run
npm run bench           # full benchmark suite (incl. vs-bitECS)
npm run typecheck       # tsc --noEmit
npm run example:basic   # run examples/basic.ts
```

## Documentation

- [**API.md**](docs/API.md) — complete public API reference with signatures and examples.
- [**ARCHITECTURE.md**](docs/ARCHITECTURE.md) — locked design decisions, module boundaries, and dependency direction.
- [**PERFORMANCE.md**](docs/PERFORMANCE.md) — benchmark methodology, per-workload tables, and phase-by-phase progression vs bitECS.
- [**examples/**](examples/) — three runnable scripts from hello-world to realistic `.io`-style scenario.

## Project layout

```
src/
├── core/          World, EntityStore (slot allocator + generations)
├── storage/       SparseSet, EntityBitmask, ComponentStore, SideTable
├── schema/        defineComponent, ComponentRegistry, ComponentInfo
├── query/         Query, QueryBuilder, QuerySnapshot, matcher
├── system/        System base, Scheduler, topoSort
├── events/        EventBus, EventChannel, defineEvent
├── types/         EntityRef, EntityHandle, Generation, constants
├── utils/         growTypedArray, assertions
└── internal/      constants (not exported)

test/              189 tests across all modules
bench/             7 benchmark suites (incl. bench/vs-bitecs/)
examples/          basic · survival-demo · performance-patterns
docs/              ARCHITECTURE · PERFORMANCE · API
```

## Status

🟢 **Feature complete for production game servers.** 189 tests passing, ESM + CJS bundles built, zero runtime dependencies, API stable.
