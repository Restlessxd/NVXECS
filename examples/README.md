# Examples

Three focused scripts covering the main ways to use `nvx-ecs`.

## Running

From the package directory:

```bash
npm run example:basic        # minimal hello-world
npm run example:survival     # realistic .io-style scenario
npm run example:perf         # fast-path patterns + microbenchmarks
```

Or from the repo root:

```bash
npm run example:ecs:basic
npm run example:ecs:survival
npm run example:ecs:perf
```

Examples run directly through [`tsx`](https://github.com/esbuild-kit/tsx) — no build step required.

## What each file covers

### [basic.ts](basic.ts)

The minimum viable ECS setup in ~80 lines. Demonstrates:

- `defineComponent` with `storage: 'dense'`
- Subclassing `System` with `reads` / `writes` declarations
- Building a query once in `init`, re-using it across ticks
- Zero-allocation iteration via `query.snapshot()`
- Calling `world.tick(dt)` through the scheduler

Read this first.

### [survival-demo.ts](survival-demo.ts)

A trimmed-down `.io`-style survival simulation in ~230 lines. Demonstrates:

- Four components with mixed storage modes
- Four systems wired into explicit stages (`input`, `update`, `postUpdate`, `network`)
- A `defineEvent` channel with `emit` / `readEvents` across systems in the same tick
- Stale-handle detection via `world.isAlive` before applying damage
- Deferred entity destruction via `world.destroyEntity` — cascades to all components at end of tick
- Stage ordering + dependency-sorted execution order

The output prints per-second telemetry so you can watch starvation kill the population over ~6 seconds of simulated time.

### [performance-patterns.ts](performance-patterns.ts)

Side-by-side microbenchmarks of the opt-in fast paths in ~150 lines. Compares:

1. `storage: 'sparse'` (default) vs `'dense'` on attach throughput
2. `world.add(e, def, init)` vs `attachEmpty` + direct field writes
3. `forEach` callback vs `snapshot()` + plain `for` loop for iteration
4. `world.has`, `hasById`, `hasByInfo` membership checks

Run it on your hardware and you'll see the same speedups the `vs-bitecs` suite records. Good reference for which pattern to reach for in a given hot path.

## Next steps

- [ARCHITECTURE.md](../docs/ARCHITECTURE.md) — design decisions and dependency layering
- [PERFORMANCE.md](../docs/PERFORMANCE.md) — benchmarks, methodology, and phase-by-phase perf history
- [API.md](../docs/API.md) — full API reference
