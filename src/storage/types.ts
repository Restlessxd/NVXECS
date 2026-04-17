/**
 * Storage-layer type definitions.
 *
 * These types describe the *shape* of component data — schema and query layers
 * build on top. The storage layer itself is deliberately untyped at the data
 * level (arrays are accessed by field name), leaving static typing to the
 * schema layer which can generate type-safe accessors at component definition
 * time.
 */

import type { EntityRef } from '../types/index.js';

/** Supported numeric / structural field kinds for a component. */
export type FieldKind =
    | 'f32'
    | 'f64'
    | 'i8'
    | 'u8'
    | 'i16'
    | 'u16'
    | 'i32'
    | 'u32'
    | 'bool' // stored as Uint8 (0/1)
    | 'ref' // pair of Uint32 (index + generation) for an entity reference
    | 'side'; // off-dense side table (Map<EntityRef, T>) for non-hot reference types

/** Declaration of a single component field. */
export interface FieldSpec {
    readonly name: string;
    readonly kind: FieldKind;
}

/** Options accepted by a fresh {@link ComponentStore}. */
export interface ComponentStoreOptions {
    /** Starting length of the dense/field arrays (per-entity rows). */
    initialDenseCapacity?: number;
    /** Starting length of the sparse lookup array (max-ref + 1). */
    initialSparseCapacity?: number;
}

/** Return value of {@link SparseSet.remove} describing the resulting swap. */
export interface RemoveResult {
    /** Dense slot that the removed entity used to occupy. */
    readonly removedIndex: number;
    /**
     * Entity ref that was swapped into the freed slot, if any.
     * `null` means the removed entity was the last one — no swap happened.
     */
    readonly movedRef: EntityRef | null;
}
