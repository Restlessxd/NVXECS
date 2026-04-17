/**
 * System-layer type definitions.
 *
 * Stages are plain strings to allow the user to name their own phases
 * (`"input"`, `"preUpdate"`, `"physics"`, `"network"`, etc.) without
 * recompiling the library. A `Scheduler` holds an ordered list of stages;
 * every registered system declares which stage it belongs to.
 *
 * {@link SystemContext} is a small read-only object that the scheduler hands
 * to every system each tick. The scheduler reuses the *same* object across
 * calls, mutating its fields in place — systems must not cache or store it
 * across ticks.
 */

/** Coarse ordering bucket. Systems inside the same stage are topo-sorted by `reads`/`writes`. */
export type SystemStage = string;

/** Default stage name when a system doesn't pick one. */
export const DEFAULT_STAGE: SystemStage = 'update';

/**
 * Runtime metadata passed to a system's `update()` each tick.
 *
 * ⚠️ Do not store across calls — the scheduler mutates this object in place
 * for the next invocation.
 */
export interface SystemContext {
    /** Elapsed seconds since the previous tick. */
    readonly dt: number;
    /** Monotonically increasing tick counter; starts at 0. */
    readonly tick: number;
    /** Stage currently being executed. */
    readonly stage: SystemStage;
}

/** Internal mutable alias used by the scheduler to fill the context in place. */
export interface MutableSystemContext {
    dt: number;
    tick: number;
    stage: SystemStage;
}
