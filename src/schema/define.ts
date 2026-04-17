/**
 * {@link defineComponent} — the user-facing factory for component schemas.
 *
 * A component definition is a pure, frozen descriptor: a name, a field map,
 * and a storage mode. The returned object carries no world-specific state;
 * the same definition may be registered with multiple worlds independently.
 * Per-world component IDs are assigned by
 * {@link ComponentRegistry.register} at registration time.
 */

import type { ComponentDef, ComponentStorageMode, FieldMap } from './types.js';

export interface DefineComponentInput<F extends FieldMap> {
    /** Human-readable name, used in errors, profiling, and network schemas. */
    readonly name: string;
    /** Field declarations — keys become property names on views and init objects. */
    readonly fields: F;
    /**
     * Storage layout. `'sparse'` (default) scales memory with component
     * population; `'dense'` sizes every field array to the world's max
     * entity capacity and indexes directly by `ref` — faster access in hot
     * loops, more memory for rarely-used components.
     *
     * Pick `'dense'` for components held by most entities (Position,
     * Velocity, Alive, NetworkSynced). Keep `'sparse'` (the default) for
     * niche components (Workbench, Circuit, SolarPanel).
     */
    readonly storage?: ComponentStorageMode;
}

/**
 * Declare a component. Returns a frozen descriptor suitable for
 * {@link World.register}.
 *
 * @example
 * ```ts
 * const Position = defineComponent({
 *     name: 'Position',
 *     fields: { x: 'f32', y: 'f32' },
 *     storage: 'dense',  // held by most entities — opt into dense
 * });
 *
 * const Workbench = defineComponent({
 *     name: 'Workbench',
 *     fields: { tier: 'u8' },
 *     // default: 'sparse' — only a handful of entities hold this
 * });
 * ```
 */
export function defineComponent<F extends FieldMap>(
    input: DefineComponentInput<F>,
): ComponentDef<F> {
    return Object.freeze({
        name: input.name,
        fields: Object.freeze({ ...input.fields }),
        storage: input.storage ?? 'sparse',
    });
}
