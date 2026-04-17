/**
 * Stage-oriented, dependency-sorted system scheduler.
 *
 * Model:
 *  - Systems are grouped by their `stage` string.
 *  - Stage execution follows the order configured at construction time.
 *  - Within a stage, systems are topologically sorted by `reads` / `writes`:
 *    if A writes a component B reads, A runs first; if both write the same
 *    component, the first-registered runs first (stability). Cyclic
 *    read/write dependencies throw at registration time.
 *
 * The scheduler reuses a single {@link SystemContext} object across calls
 * to avoid per-tick allocation. At the end of each tick it flushes the
 * world's deferred-destroy queue.
 *
 * Hot reload:
 *  - {@link replace} swaps a named system's implementation, calling
 *    `destroy()` on the outgoing instance and `init()` on the incoming one.
 *    The world's data (components, entities) is preserved across swaps.
 */

import { DEFAULT_STAGE } from './types.js';
import type { ComponentDef } from '../schema/types.js';
import type { MutableSystemContext, SystemStage } from './types.js';
import type { System } from './system.js';
import type { World } from '../core/world.js';

export interface SchedulerOptions {
    /** Ordered list of stages. Systems in stages outside this list are rejected. */
    stages?: readonly SystemStage[];
}

const DEFAULT_STAGES: readonly SystemStage[] = [DEFAULT_STAGE];

export class Scheduler {
    private readonly _world: World;
    private readonly _stageOrder: SystemStage[];
    private readonly _byStage = new Map<SystemStage, System[]>();
    private readonly _sortedByStage = new Map<SystemStage, System[]>();
    private readonly _byName = new Map<string, System>();
    private _tick = 0;

    /** Reused context — scheduler mutates in place each tick to stay zero-alloc. */
    private readonly _ctx: MutableSystemContext = { dt: 0, tick: 0, stage: DEFAULT_STAGE };

    constructor(world: World, opts: SchedulerOptions = {}) {
        this._world = world;
        this._stageOrder = (opts.stages ?? DEFAULT_STAGES).slice();
        for (const stage of this._stageOrder) this._byStage.set(stage, []);
    }

    /** Total registered systems across all stages. */
    get systemCount(): number {
        return this._byName.size;
    }

    /** Ordered list of stages this scheduler knows about. */
    get stages(): readonly SystemStage[] {
        return this._stageOrder;
    }

    /** Register a system. Calls `init(world)` and re-sorts its stage. */
    register(system: System): void {
        if (this._byName.has(system.name)) {
            throw new Error(`[nvx-ecs] system "${system.name}" is already registered`);
        }
        const stage = system.stage;
        const bucket = this._byStage.get(stage);
        if (bucket === undefined) {
            throw new Error(
                `[nvx-ecs] system "${system.name}" uses unknown stage "${stage}"; ` +
                    `known stages: ${this._stageOrder.join(', ')}`,
            );
        }

        bucket.push(system);
        this._byName.set(system.name, system);
        system.init?.(this._world);
        this._resort(stage);
    }

    /** Unregister a system by name. Calls `destroy(world)`. Returns `true` if removed. */
    unregister(name: string): boolean {
        const sys = this._byName.get(name);
        if (sys === undefined) return false;

        const bucket = this._byStage.get(sys.stage)!;
        const idx = bucket.indexOf(sys);
        bucket.splice(idx, 1);
        this._byName.delete(name);
        sys.destroy?.(this._world);
        this._resort(sys.stage);
        return true;
    }

    /**
     * Replace a named system's implementation in place.
     *
     * `destroy(world)` is called on the outgoing system; `init(world)` is
     * called on the incoming one. World state (components / entities) is
     * preserved across the swap — this is the hook used by hot reload.
     */
    replace(name: string, next: System): boolean {
        const prev = this._byName.get(name);
        if (prev === undefined) return false;
        if (next.name !== name) {
            throw new Error(
                `[nvx-ecs] replacement system name "${next.name}" does not match "${name}"`,
            );
        }

        const prevStage = prev.stage;
        const nextStage = next.stage;

        // Remove prev from its stage bucket.
        const prevBucket = this._byStage.get(prevStage)!;
        prevBucket.splice(prevBucket.indexOf(prev), 1);

        // Ensure the new stage exists.
        const nextBucket = this._byStage.get(nextStage);
        if (nextBucket === undefined) {
            // Roll back and complain — don't leave the scheduler in a half-applied state.
            prevBucket.push(prev);
            throw new Error(
                `[nvx-ecs] replacement system "${name}" uses unknown stage "${nextStage}"`,
            );
        }

        prev.destroy?.(this._world);
        nextBucket.push(next);
        this._byName.set(name, next);
        next.init?.(this._world);

        this._resort(prevStage);
        if (prevStage !== nextStage) this._resort(nextStage);
        return true;
    }

    /** Look up a registered system by name. */
    get(name: string): System | undefined {
        return this._byName.get(name);
    }

    /** Is a system with this name registered? */
    has(name: string): boolean {
        return this._byName.has(name);
    }

    /** Resolved execution order for a stage (topologically sorted). */
    executionOrder(stage: SystemStage): readonly System[] {
        return this._sortedByStage.get(stage) ?? [];
    }

    /**
     * Execute one tick.
     *
     *  1. For each stage in order, run every system in topologically sorted order.
     *  2. After all stages complete, flush the world's deferred-destroy queue.
     *
     * `dt` is delivered to systems via {@link SystemContext.dt}.
     */
    tick(dt: number): void {
        const ctx = this._ctx;
        ctx.dt = dt;
        ctx.tick = this._tick;

        for (let s = 0; s < this._stageOrder.length; s++) {
            const stage = this._stageOrder[s]!;
            ctx.stage = stage;
            const systems = this._sortedByStage.get(stage);
            if (systems === undefined) continue;
            for (let i = 0; i < systems.length; i++) {
                systems[i]!.update(this._world, ctx);
            }
        }

        this._world.flushPendingDestroys();
        this._world.events.clearAll();
        this._tick++;
    }

    /** Tear down every registered system. */
    destroyAll(): void {
        for (const sys of this._byName.values()) {
            sys.destroy?.(this._world);
        }
        this._byName.clear();
        for (const bucket of this._byStage.values()) bucket.length = 0;
        this._sortedByStage.clear();
    }

    private _resort(stage: SystemStage): void {
        const bucket = this._byStage.get(stage);
        if (bucket === undefined) return;
        this._sortedByStage.set(stage, topoSort(bucket));
    }
}

/**
 * Topologically sort systems within a stage by their `reads` / `writes`.
 *
 * Edges (A → B means "A runs before B"):
 *  - A.writes ∩ B.reads ≠ ∅ → A → B (B depends on A's output)
 *  - A.reads ∩ B.writes ≠ ∅ → B → A (A reads what B produces)
 *  - A.writes ∩ B.writes ≠ ∅ → A → B if A was registered first (stable order)
 *
 * Throws on cyclic dependencies.
 */
export function topoSort(systems: readonly System[]): System[] {
    const n = systems.length;
    if (n <= 1) return systems.slice();

    const edges: number[][] = Array.from({ length: n }, () => []);
    const inDeg = new Uint32Array(n);

    const addEdge = (from: number, to: number): void => {
        edges[from]!.push(to);
        inDeg[to]!++;
    };

    for (let i = 0; i < n; i++) {
        const A = systems[i]!;
        for (let j = i + 1; j < n; j++) {
            const B = systems[j]!;

            if (intersects(A.writes, B.reads)) addEdge(i, j);
            if (intersects(A.reads, B.writes)) addEdge(j, i);
            if (intersects(A.writes, B.writes)) addEdge(i, j);
        }
    }

    // Kahn's algorithm. Enqueue in registration order for stable output.
    const queue: number[] = [];
    for (let i = 0; i < n; i++) {
        if (inDeg[i] === 0) queue.push(i);
    }

    const out: System[] = [];
    let head = 0;
    while (head < queue.length) {
        const i = queue[head++]!;
        out.push(systems[i]!);
        const adj = edges[i]!;
        for (let k = 0; k < adj.length; k++) {
            const j = adj[k]!;
            if (--inDeg[j]! === 0) queue.push(j);
        }
    }

    if (out.length < n) {
        const remaining = systems
            .filter((_, i) => inDeg[i]! > 0)
            .map((s) => s.name)
            .join(', ');
        throw new Error(
            `[nvx-ecs] cyclic system dependency detected among: ${remaining}`,
        );
    }
    return out;
}

function intersects(a: readonly ComponentDef[], b: readonly ComponentDef[]): boolean {
    if (a.length === 0 || b.length === 0) return false;
    // Small N (usually ≤ 10 per system) — linear scan is fastest.
    for (let i = 0; i < a.length; i++) {
        const av = a[i]!;
        for (let j = 0; j < b.length; j++) {
            if (av === b[j]) return true;
        }
    }
    return false;
}
