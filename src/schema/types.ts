/**
 * Schema-layer types.
 *
 * These types turn a plain `{ field: kind }` declaration into full TypeScript
 * inference for views, init objects, and per-field access — so that
 * `world.view(Position).x` is typed as `Float32Array`, not `unknown`.
 *
 * The storage layer underneath remains fully dynamic; inference lives here
 * and is erased at runtime.
 */

import type { RefFieldArrays } from '../storage/component-store.js';
import type { SideTable } from '../storage/side-table.js';
import type { SparseSet } from '../storage/sparse-set.js';
import type { ComponentStore } from '../storage/component-store.js';
import type { FieldKind } from '../storage/types.js';
import type { EntityHandle } from '../types/index.js';

/** Subset of {@link FieldKind} values that get backed by a numeric typed array. */
export type NumericFieldKind =
    | 'f32'
    | 'f64'
    | 'i8'
    | 'u8'
    | 'i16'
    | 'u16'
    | 'i32'
    | 'u32'
    | 'bool';

/** A component's schema: a record of field-name → kind. */
export type FieldMap = { readonly [name: string]: FieldKind };

/**
 * Storage layout for a component.
 *
 *  - **`'sparse'`** (default) — field arrays sized by component population
 *    and indexed by dense position (`sparseSet.sparse[ref]`). Low memory
 *    footprint for rarely-used components. Access pattern:
 *    `view.x[view.sparseSet.sparse[ref]]`.
 *
 *  - **`'dense'`** — field arrays sized by `maxEntityCapacity` and indexed
 *    **directly by entity ref**. Higher memory cost but one fewer load per
 *    access in hot paths. Recommended for components held by most
 *    entities (Position, Velocity, Alive). Access pattern: `view.x[ref]`.
 */
export type ComponentStorageMode = 'sparse' | 'dense';

/** Opaque component descriptor produced by {@link defineComponent}. */
export interface ComponentDef<F extends FieldMap = FieldMap> {
    readonly name: string;
    readonly fields: F;
    readonly storage: ComponentStorageMode;
}

// ─── View type inference ──────────────────────────────────────────────────

/** Typed-array class used to back a given numeric field kind. */
export type NumericArrayFor<K extends NumericFieldKind> = K extends 'f32'
    ? Float32Array
    : K extends 'f64'
      ? Float64Array
      : K extends 'i8'
        ? Int8Array
        : K extends 'u8' | 'bool'
          ? Uint8Array
          : K extends 'i16'
            ? Int16Array
            : K extends 'u16'
              ? Uint16Array
              : K extends 'i32'
                ? Int32Array
                : K extends 'u32'
                  ? Uint32Array
                  : never;

/** What the view returns for a given field kind. */
export type ViewField<K extends FieldKind> = K extends NumericFieldKind
    ? NumericArrayFor<K>
    : K extends 'ref'
      ? RefFieldArrays
      : K extends 'side'
        ? SideTable<unknown>
        : never;

/**
 * A typed "view" over a component's storage: one property per field plus
 * references to the underlying {@link ComponentStore} and {@link SparseSet}.
 *
 * Cache the view once per system invocation — it holds direct references to
 * the live typed arrays, so inner loops stay tight.
 *
 * Access pattern depends on the component's storage mode:
 *  - **sparse:** `view.x[view.sparseSet.sparse[ref]]`
 *  - **dense:**  `view.x[ref]` — the sparse lookup is elided.
 */
export type ComponentView<F extends FieldMap> = {
    readonly store: ComponentStore;
    readonly sparseSet: SparseSet;
} & {
    readonly [K in keyof F]: ViewField<F[K]>;
};

// ─── Init type inference ──────────────────────────────────────────────────

/** JavaScript value type accepted when initializing a field. */
export type InitValue<K extends FieldKind> = K extends NumericFieldKind
    ? K extends 'bool'
        ? boolean | number
        : number
    : K extends 'ref'
      ? EntityHandle
      : K extends 'side'
        ? unknown
        : never;

/** Partial init object passed to `world.add(entity, def, init)`. */
export type ComponentInit<F extends FieldMap> = {
    readonly [K in keyof F]?: InitValue<F[K]>;
};
