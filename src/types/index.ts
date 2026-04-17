/**
 * Core public types for nvx-ecs.
 * Lives at the root of the dependency graph — imports nothing from other layers.
 */

/** A `uint32` slot index identifying an entity within a {@link World}. */
export type EntityRef = number;

/** A `uint32` version counter for a slot. Bumped on destroy; used to detect stale references. */
export type Generation = number;

/**
 * A strong reference to an entity, stable across slot reuse.
 *
 * Inside a tick, systems iterate live entities by `ref` alone; no generation check is needed.
 * Cross-tick or externally cached references should use the full handle so that
 * {@link World.isAlive} can detect reuse of a slot by a different entity.
 */
export interface EntityHandle {
    readonly ref: EntityRef;
    readonly gen: Generation;
}

/** Reserved `EntityRef` meaning "no entity". */
export const INVALID_REF: EntityRef = 0xffffffff;

/** Reserved `Generation` meaning "never allocated". Fresh slots start at `1`. */
export const INVALID_GEN: Generation = 0;
