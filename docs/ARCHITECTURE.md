# Architecture

Locked design decisions for `nvx-ecs`. Revisit only with explicit justification — these choices define the perf/complexity budget.

## Entity model

**Unpacked generations.** An entity has two parts:
- `EntityRef` — a `uint32` slot index (`0 .. 2^32 - 1`)
- `Generation` — a `uint32` version counter stored in a parallel `Uint32Array` (`world.generations`)

When a slot is destroyed and reused, its generation is bumped. External references use `EntityHandle { ref, gen }` to survive slot reuse; `world.isAlive(handle)` compares the stored generation with the handle's generation.

**Why unpacked:**
- 32-bit generations = 4 billion reuses per slot before wrap. At realistic churn (survival `.io`, months of uptime), this is effectively infinite.
- Hot iteration paths only use `ref` (index) — no unpacking overhead.
- Generation check happens only at API boundaries (external cached refs, incoming network packets), not in tight loops.

**Component ref fields** (e.g., "who is my AI target?") use two parallel `Uint32Array`: one for the ref, one for the generation. Validation is one array read + compare.

## Storage

**Sparse set per component.** For each registered component, the storage is:

```
dense:  Uint32Array   — compact list of entity refs that have this component
sparse: Uint32Array   — maps entity ref → position in dense (or INVALID)
data:   TypedArray[]  — one typed array per numeric field, parallel to dense
side:   Map<ref, T>?  — optional side-table for non-numeric ref fields
```

**Why sparse set over archetype:**
- O(1) add / remove component — survival games have heavy structural churn (pickup/drop, craft transforms, spawn/die).
- Iteration is still cache-friendly: dense arrays are sequential.
- Queries over multiple components use bitmasks for membership testing (Uint32Array chunks per entity) — fast.

## Component layout

**Mixed SoA.** Within a component:
- Numeric fields (`f32`, `f64`, `i32`, `u32`, `i16`, `u16`, `i8`, `u8`, `bool`, `enum`) → typed arrays parallel to the component's dense list.
- Reference fields (`ref` — pointer to another entity) → two parallel `Uint32Array` (index + generation).
- Non-hot reference types (strings, arrays, objects) → side-table `Map<ref, T>`.

**Why mixed:**
- 90% of hot data in game logic is numeric (position, health, timers) — benefits from SoA cache locality.
- Reference data (inventory list, status effects) is rarely touched per tick — side-table is fine.
- V8 optimizes `Uint32Array` / `Float32Array` access to near-native speed.

## Entity ID encoding

```
EntityRef   = uint32 index (0 .. 2^32 - 1)
Generation  = uint32 per slot in Uint32Array
EntityHandle = { ref: EntityRef, gen: Generation }  — user-facing handle for stale-ref detection
```

`INVALID_REF = 0xFFFFFFFF` is reserved as the null-entity sentinel.

## Scheduler

**Dependency-based.** Systems declare `reads` and `writes` component sets. Scheduler performs topological sort at registration time, producing a flat execution order.

- **v1**: single-threaded, executes ordered array sequentially. Zero overhead vs hand-ordered.
- **v2 (future)**: worker-thread parallel execution. Systems that share no writes run on different threads. Requires `SharedArrayBuffer` for component storage (already typed arrays — trivial to port).

## Deferred destroy

Entity destruction is **buffered until end of tick**. Inside a tick, systems may hold entity refs without worrying about mid-tick reuse.

## NVX Protocol integration

**Adapter pattern.** `nvx-ecs` is pure — no protocol dependency. A future `nvx-ecs-sync` library will:
- Hook into component writes via a pluggable `onWrite` callback
- Maintain dirty sets per component per entity
- Generate delta packets using NVX wire format

## Spatial queries

**External library.** `nvx-spatial` (future) — cell-based spatial hashing. Used by both server (AOI, collision broadphase) and client (render culling). Not a dependency of `nvx-ecs`.

## Hot reload

**Dev-only via `NVX_ECS_DEV=1`.**
- esbuild watch rebuilds system files to `dev-dist/`
- `world.replaceSystem(name, newImpl)` swaps implementation
- Component data and entity state preserved across reloads
- Tree-shaken out of prod builds

## Dependency direction

```
utils       → (nothing)
types       → utils
core        → utils, types
storage     → core, utils, types
schema      → core, storage, utils, types
query       → core, storage, schema, utils, types
system      → core, query, utils, types
events      → core, utils, types
devtools    → any (dev-only, tree-shaken in prod)
index.ts    → explicit re-exports of public API only
internal/   → not exported; used only inside lib
```

No cycles. No imports from `internal/` outside the library.

## Target

**Node.js server v1.** Code uses only standard JS APIs (typed arrays, `Map`, `Set`, `performance.now()`) — isomorphic-ready when browser ECS is needed.
