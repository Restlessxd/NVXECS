/**
 * Abstract base for a tick-driven system.
 *
 * A concrete system declares:
 *  - `name` — unique identifier used for hot reload, logging, and scheduler
 *    ordering. Must be stable across the lifetime of the scheduler.
 *  - `reads` / `writes` — component dependency sets used by the scheduler's
 *    topological sort. Systems whose `writes` overlap another's `reads` run
 *    first; cycles are detected and rejected at registration time.
 *  - `stage` — coarse execution phase. Default is {@link DEFAULT_STAGE}.
 *
 * Lifecycle:
 *  1. `init(world)` — called once on registration. Set up queries and
 *     per-system caches here.
 *  2. `update(world, ctx)` — called once per tick in the owning stage.
 *  3. `destroy(world)` — called on unregistration or hot reload replacement.
 *
 * Keep `update` allocation-free: fetch views at the top, iterate over typed
 * arrays in a tight loop.
 */

import { DEFAULT_STAGE } from './types.js';
import type { ComponentDef } from '../schema/types.js';
import type { SystemContext, SystemStage } from './types.js';
import type { World } from '../core/world.js';

export abstract class System {
    /** Unique identifier. Used for hot reload and scheduler bookkeeping. */
    abstract readonly name: string;

    /** Components this system reads. Empty by default. */
    readonly reads: readonly ComponentDef[] = [];

    /** Components this system writes. Empty by default. */
    readonly writes: readonly ComponentDef[] = [];

    /** Stage to execute in. Defaults to `'update'`. */
    readonly stage: SystemStage = DEFAULT_STAGE;

    /** One-time setup. Invoked when the system is registered. */
    init?(world: World): void;

    /** Per-tick behavior. Required. */
    abstract update(world: World, ctx: SystemContext): void;

    /** One-time teardown. Invoked on unregister or hot-reload replacement. */
    destroy?(world: World): void;
}
