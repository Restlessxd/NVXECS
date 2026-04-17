# API Reference

Complete reference for every symbol exported from `nvx-ecs`. Paired with runnable code in [`examples/`](../examples/); see that folder first for end-to-end workflows.

---

## Table of Contents

1. [Quick start](#quick-start)
2. [Core types](#core-types)
    - [`EntityRef`, `Generation`, `EntityHandle`](#entityref-generation-entityhandle)
3. [World](#world)
    - [Constructor + options](#constructor)
    - [Entity lifecycle](#entity-lifecycle)
    - [Component registration + access](#component-registration--access)
    - [Queries](#queries)
    - [Events](#events)
    - [Systems + tick](#systems--tick)
    - [Advanced accessors](#advanced-accessors)
4. [Components](#components)
    - [`defineComponent`](#definecomponent)
    - [`ComponentDef` + storage modes](#componentdef--storage-modes)
    - [Field kinds](#field-kinds)
    - [`ComponentView`](#componentview)
    - [`ComponentInit`](#componentinit)
    - [`ComponentInfo`](#componentinfo)
5. [Queries](#queries-1)
    - [`QueryBuilder`](#querybuilder)
    - [`Query`](#query)
    - [`QuerySnapshot`](#querysnapshot)
6. [Systems](#systems)
    - [`System` base class](#system-base-class)
    - [`Scheduler`](#scheduler)
    - [`SystemContext`](#systemcontext)
7. [Events](#events-1)
    - [`defineEvent`](#defineevent)
    - [`EventBus`](#eventbus)
    - [`EventView`](#eventview)
8. [Storage primitives](#storage-primitives)
    - [`SparseSet`](#sparseset)
    - [`EntityBitmask`](#entitybitmask)
    - [`SideTable`](#sidetable)
    - [`ComponentStore`](#componentstore)
    - [`ComponentRegistry`](#componentregistry)
9. [Utilities](#utilities)
    - [`growTypedArray`, `TypedNumericArray`](#growtypedarray-typednumericarray)

---

## Quick start

```ts
import { World, defineComponent, System, type SystemContext, Query } from 'nvx-ecs';

const Position = defineComponent({
    name: 'Position',
    fields: { x: 'f32', y: 'f32' },
    storage: 'dense',
});

class MovementSystem extends System {
    readonly name = 'Movement';
    override readonly writes = [Position];
    private q!: Query;

    override init(world: World) {
        this.q = world.query().with(Position).build();
    }
    update(world: World, ctx: SystemContext) {
        const pos = world.view(Position);
        const snap = this.q.snapshot();
        for (let i = 0; i < snap.count; i++) {
            const ref = snap.refs[i]!;
            pos.x[ref] = pos.x[ref]! + ctx.dt;
        }
    }
}

const world = new World();
world.register(Position);
world.registerSystem(new MovementSystem());
const e = world.createEntity();
world.add(e, Position, { x: 0, y: 0 });
world.tick(1 / 30);
```

---

## Core types

### `EntityRef`, `Generation`, `EntityHandle`

```ts
type EntityRef = number;      // uint32 slot index
type Generation = number;     // uint32 version counter

interface EntityHandle {
    readonly ref: EntityRef;
    readonly gen: Generation;
}

const INVALID_REF: EntityRef = 0xffffffff;
const INVALID_GEN: Generation = 0;
```

A `World` returns `EntityHandle`s; hot-path systems usually destructure `handle.ref` once and work with raw refs. Handles survive slot reuse: `world.isAlive(handle)` compares the handle's `gen` with the slot's current generation.

---

## World

The central orchestrator. Owns entity slots, component storage, events, and the scheduler.

### Constructor

```ts
interface WorldOptions {
    initialEntityCapacity?: number; // default: 1024
    scheduler?: SchedulerOptions;   // default: stages = ['update']
}

const world = new World({ initialEntityCapacity: 10_000 });
```

The world grows automatically as entities are created; `initialEntityCapacity` is just the starting size of the backing arrays.

### Entity lifecycle

```ts
world.createEntity(): EntityHandle

world.destroyEntity(handle: EntityHandle): void
// Deferred — the entity stays alive until `flushPendingDestroys` runs
// (called automatically by `world.tick` at end of tick).

world.flushPendingDestroys(): number
// Returns the count of entities actually destroyed (stale entries skipped).

world.isAlive(handle: EntityHandle): boolean
world.generationOf(ref: EntityRef): Generation

world.aliveEntityCount: number
world.pendingDestroyCount: number
world.entityCapacity: number
```

### Component registration + access

```ts
world.register(def: ComponentDef): number
// Returns the assigned component id. Idempotent — re-registering the same
// def returns the existing id. Components *must* be registered before
// any `add` / `view` / `query`.

world.add<F>(handle: EntityHandle, def: ComponentDef<F>, init?: ComponentInit<F>): void
world.remove(handle: EntityHandle, def: ComponentDef): boolean
world.has(handle: EntityHandle, def: ComponentDef): boolean

// Fast paths:
world.attachEmpty(handle: EntityHandle, def: ComponentDef): number
// Skips init dispatch; returns the field-array index for direct writes.

world.hasById(ref: EntityRef, def: ComponentDef): boolean
// Same as `has` but takes a raw ref — one fewer property access.

world.hasByInfo(ref: EntityRef, info: ComponentInfo): boolean
// Zero Map-lookup fast path when caller already resolved the info.

world.infoOf(def: ComponentDef): ComponentInfo | undefined
// Resolve once at system init; pass the result to `hasByInfo` in hot loops.

world.view<F>(def: ComponentDef<F>): ComponentView<F>
// Typed view over the component's storage. Cache once per system invocation.
```

### Queries

```ts
world.query(): QueryBuilder
// Fluent: world.query().with(A, B).without(C).build() → Query
```

### Events

```ts
world.registerEvent(def: EventDef): void
world.emit<F>(def: EventDef<F>, init?: EventInit<F>): void
world.readEvents<F>(def: EventDef<F>): EventView<F>
// Event buffers auto-clear at the end of every tick.
```

### Systems + tick

```ts
world.registerSystem(system: System): void
world.unregisterSystem(name: string): boolean
world.replaceSystem(name: string, next: System): boolean
// Hot reload: destroys the outgoing instance, inits the incoming one.

world.tick(dt: number): void
// One full cycle: stage-ordered system execution → deferred destroys → event clear.
```

### Advanced accessors

```ts
world.registry: ComponentRegistry   // per-world component tables
world.scheduler: Scheduler          // system scheduler
world.events: EventBus              // event channels
```

---

## Components

### `defineComponent`

```ts
function defineComponent<F extends FieldMap>(input: {
    name: string;
    fields: F;
    storage?: ComponentStorageMode; // 'sparse' | 'dense', default 'sparse'
}): ComponentDef<F>
```

Returns a frozen descriptor. Declaration is world-agnostic — the same def may be registered with multiple worlds (each assigns its own `componentId`).

### `ComponentDef` + storage modes

```ts
type ComponentStorageMode = 'sparse' | 'dense';

interface ComponentDef<F extends FieldMap> {
    readonly name: string;
    readonly fields: F;
    readonly storage: ComponentStorageMode;
}
```

| Mode | Field array size | Indexing | Trade-off |
|---|---|---|---|
| `sparse` (default) | component population | `view.x[view.sparseSet.sparse[ref]]` | memory scales with usage |
| `dense` | max entity capacity | `view.x[ref]` | one fewer load per access, more memory |

Use `dense` for hot components held by most entities (Position, Velocity, Alive). Use `sparse` for niche components (Workbench, Circuit, etc.).

### Field kinds

```ts
type FieldKind =
    | 'f32' | 'f64'
    | 'i8' | 'u8' | 'i16' | 'u16' | 'i32' | 'u32'
    | 'bool'   // stored as Uint8
    | 'ref'    // parallel Uint32 (index + generation) — an EntityHandle
    | 'side';  // off-dense Map<EntityRef, T> for non-numeric payloads
```

### `ComponentView`

```ts
type ComponentView<F> = {
    readonly store: ComponentStore;
    readonly sparseSet: SparseSet;
} & {
    readonly [K in keyof F]: ViewField<F[K]>;
};
```

Where `ViewField<K>` resolves to:

- `f32` → `Float32Array`, `i32` → `Int32Array`, etc.
- `bool` → `Uint8Array`
- `ref` → `{ index: Uint32Array; generation: Uint32Array }`
- `side` → `SideTable<unknown>`

```ts
const pos = world.view(Position);
pos.x[ref] = 10;                  // dense mode
pos.x[pos.sparseSet.sparse[ref]!] = 10; // sparse mode
```

**Caching:** `world.view(def)` returns the **same object reference** every
call — the view is built once lazily and updated in place whenever the
store's field arrays reallocate. Calling it inside hot loops is free
(~6 ns / call per microbenchmark); no allocation, no field-iteration cost.
The conventional pattern of hoisting to the top of `update()` is still
recommended because it reads cleaner, not for performance reasons.

### `ComponentInit`

```ts
type ComponentInit<F> = {
    readonly [K in keyof F]?: InitValue<F[K]>;
};
```

`bool` accepts `boolean | number`; `ref` accepts `EntityHandle`; `side` accepts any value.

### `ComponentInfo`

```ts
interface ComponentInfo {
    readonly id: number;
    readonly generationId: number;  // id >>> 5
    readonly bitflag: number;       // 1 << (id & 31)
}
```

Precomputed at registration and returned by `world.infoOf(def)`. Passing it to `world.hasByInfo(ref, info)` elides the component-map lookup in membership probes.

---

## Queries

### `QueryBuilder`

```ts
class QueryBuilder {
    with(...defs: ComponentDef[]): this
    without(...defs: ComponentDef[]): this
    build(): Query
}
```

At least one `with` component is required. All listed components must be registered with the world before `.build()` is called.

### `Query`

```ts
class Query {
    readonly include: readonly ComponentDef[];
    readonly exclude: readonly ComponentDef[];

    count(): number
    cachedRefs(): Uint32Array        // live handle — don't store across ticks
    snapshot(): QuerySnapshot        // preferred fast path
    forEach(cb: (ref: EntityRef) => void): void
    collectInto(out: EntityRef[]): number
    [Symbol.iterator](): IterableIterator<EntityRef>
}
```

Iteration results are cached and invalidated automatically when any involved component store's `structuralVersion` changes. Between structural changes every iteration walks the cached list — no bitmask check, no driver selection.

### `QuerySnapshot`

```ts
interface QuerySnapshot {
    refs: Uint32Array;   // valid indices [0, count)
    count: number;
}
```

Returned by `Query.snapshot()`. The **same object reference** is returned every call (no per-tick allocation); the fields are refreshed in place when the cache rebuilds.

```ts
const snap = q.snapshot();
for (let i = 0; i < snap.count; i++) {
    const ref = snap.refs[i]!;
    // ...
}
```

---

## Systems

### `System` base class

```ts
abstract class System {
    abstract readonly name: string;                // unique per scheduler
    readonly reads: readonly ComponentDef[];       // default: []
    readonly writes: readonly ComponentDef[];      // default: []
    readonly stage: SystemStage;                   // default: 'update'

    init?(world: World): void;
    abstract update(world: World, ctx: SystemContext): void;
    destroy?(world: World): void;
}
```

`reads` / `writes` drive the scheduler's topological sort within a stage. Systems whose `writes` overlap another's `reads` run first; cycles throw at registration time.

### `Scheduler`

```ts
interface SchedulerOptions {
    stages?: readonly SystemStage[]; // default: ['update']
}

class Scheduler {
    readonly systemCount: number;
    readonly stages: readonly SystemStage[];

    register(system: System): void
    unregister(name: string): boolean
    replace(name: string, next: System): boolean
    get(name: string): System | undefined
    has(name: string): boolean
    executionOrder(stage: SystemStage): readonly System[]
    tick(dt: number): void
    destroyAll(): void
}

// Exported helper — the same topo-sort the scheduler uses:
function topoSort(systems: readonly System[]): System[]
```

Stage order is fixed at construction. Systems registered with an unknown stage throw immediately.

### `SystemContext`

```ts
interface SystemContext {
    readonly dt: number;           // seconds since previous tick
    readonly tick: number;         // monotonic counter, starts at 0
    readonly stage: SystemStage;   // currently-executing stage
}
```

The scheduler reuses the same object each invocation — do not store it across calls.

---

## Events

### `defineEvent`

```ts
function defineEvent<F extends FieldMap>(input: {
    name: string;
    fields: F;
}): EventDef<F>
```

Same field vocabulary as components. Events are dense, append-only buffers cleared at end of tick.

### `EventBus`

Available as `world.events`. Most users go through world shortcuts:

```ts
world.registerEvent(def)
world.emit(def, init?)
world.readEvents(def): EventView<F>
```

Advanced:

```ts
bus.register(def): EventChannel
bus.isRegistered(def): boolean
bus.channelOf(def): EventChannel
bus.clear(def): void
bus.clearAll(): void   // invoked by Scheduler.tick
bus.channelCount: number
```

### `EventView`

```ts
type EventView<F> = {
    readonly count: number;
} & {
    readonly [K in keyof F]: EventViewField<F[K]>;
};
```

Same field mapping as `ComponentView`, minus the `sparseSet` (events have no entity identity).

```ts
const events = world.readEvents(DamageEvent);
for (let i = 0; i < events.count; i++) {
    const targetRef = events.target.index[i];
    const amount = events.amount[i];
}
```

Multi-read is supported — any number of systems may consume the same buffer during a tick; only the end-of-tick clear drains it.

---

## Storage primitives

The storage layer is exposed for advanced use (custom backends, inspection, tooling). Most users never touch these directly.

### `SparseSet`

```ts
class SparseSet {
    readonly count: number;
    readonly denseCapacity: number;
    readonly sparseCapacity: number;
    readonly dense: Uint32Array;    // first `count` entries are valid
    readonly sparse: Uint32Array;   // indexed by EntityRef

    add(ref: EntityRef, onDenseGrow?: DenseGrowHook): number
    remove(ref: EntityRef): RemoveResult | null
    has(ref: EntityRef): boolean
    indexOf(ref: EntityRef): number
    clear(): void
}

type DenseGrowHook = (newCapacity: number) => void;
interface RemoveResult { removedIndex: number; movedRef: EntityRef | null; }
```

### `EntityBitmask`

```ts
class EntityBitmask {
    data: Uint32Array;               // public, indexed by [ref * chunksPerEntity + chunk]
    readonly entityCapacity: number;
    readonly chunksPerEntity: number;
    readonly componentCapacity: number;

    set(ref, componentId): void
    clear(ref, componentId): void
    has(ref, componentId): boolean
    hasFlag(ref, generationId, bitflag): boolean  // precomputed fast path
    clearAll(ref): void
    matches(ref, include: Uint32Array, exclude: Uint32Array | null): boolean
    growEntities(minCapacity): void
    growChunks(newChunksPerEntity): void
}
```

### `SideTable`

```ts
class SideTable<T> {
    readonly size: number;
    set(ref, value): void
    get(ref): T | undefined
    has(ref): boolean
    delete(ref): boolean
    clear(): void
    entries(): IterableIterator<[EntityRef, T]>
}
```

Backed by a native `Map`. Used for `side` fields where numeric typed arrays don't fit (strings, nested objects, arrays).

### `ComponentStore`

```ts
class ComponentStore {
    readonly sparseSet: SparseSet;
    readonly mode: ComponentStorageMode;
    readonly count: number;
    readonly fieldCapacity: number;
    readonly fields: readonly FieldSpec[];
    readonly structuralVersion: number;

    add(ref): number
    remove(ref): boolean
    has(ref): boolean
    indexOf(ref): number

    numericField(name: string): TypedNumericArray
    refField(name: string): RefFieldArrays
    sideField<T>(name: string): SideTable<T>
}

interface RefFieldArrays {
    readonly index: Uint32Array;
    readonly generation: Uint32Array;
}

interface FieldSpec { readonly name: string; readonly kind: FieldKind; }
```

### `ComponentRegistry`

```ts
class ComponentRegistry {
    readonly bitmask: EntityBitmask;
    readonly infoByDef: Map<ComponentDef, ComponentInfo>;
    readonly componentCount: number;

    register(def): number
    isRegistered(def): boolean
    idOf(def): number
    infoOf(def): ComponentInfo | undefined
    storeOf(def): ComponentStore
    view<F>(def): ComponentView<F>

    add<F>(ref, def, init?): void
    attachEmpty(ref, def): number
    remove(ref, def): boolean
    has(ref, def): boolean
    removeAll(ref): void
}
```

Each `World` owns a `ComponentRegistry`. Component ids are per-world.

---

## Utilities

### `growTypedArray`, `TypedNumericArray`

```ts
type TypedNumericArray =
    | Float32Array | Float64Array
    | Int8Array | Uint8Array
    | Int16Array | Uint16Array
    | Int32Array | Uint32Array;

function growTypedArray<T extends TypedNumericArray>(arr: T, newCapacity: number): T
// Allocates a fresh array of the same element type and copies the contents in.
```

Used internally by all growable storage; exported for users building their own allocators on top.
