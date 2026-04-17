/**
 * Per-component storage.
 *
 * Two storage modes, picked at construction time:
 *
 *  - **`'sparse'`** — field arrays sized by component population, indexed by
 *    dense slot (`sparseSet.sparse[ref]`). Low memory. Extra indirection on
 *    hot-path access.
 *
 *  - **`'dense'`** — field arrays sized by a growing `maxRef+1` capacity,
 *    indexed by `ref` directly. Higher memory (one slot per entity whether
 *    or not it holds the component), but one fewer load per access. Recommended
 *    for components held by a large fraction of entities.
 *
 * In both modes, a {@link SparseSet} tracks membership and iteration order.
 * What differs is only the relationship between an entity ref and its
 * position in the field arrays:
 *
 *  - sparse: `field[sparseSet.sparse[ref]]`
 *  - dense:  `field[ref]`
 *
 * Every structural mutation (`add` / `remove`) increments
 * {@link structuralVersion}, which {@link Query} reads to invalidate its
 * cached match list.
 */

import { growTypedArray } from '../utils/typed-array.js';
import { SideTable } from './side-table.js';
import { SparseSet } from './sparse-set.js';
import type { EntityRef } from '../types/index.js';
import type { ComponentStorageMode } from '../schema/types.js';
import type { ComponentStoreOptions, FieldKind, FieldSpec } from './types.js';
import type { TypedNumericArray } from '../utils/typed-array.js';

const DEFAULT_DENSE_CAPACITY = 64;
const DEFAULT_SPARSE_CAPACITY = 64;
const DEFAULT_DENSE_MODE_FIELD_CAPACITY = 1024;
const GROWTH_FACTOR = 2;

/** Ref-field storage: parallel `index` and `generation` arrays. */
export interface RefFieldArrays {
    readonly index: Uint32Array;
    readonly generation: Uint32Array;
}

export interface ComponentStoreExtendedOptions extends ComponentStoreOptions {
    /** Storage mode. Defaults to `'sparse'`. */
    mode?: ComponentStorageMode;
    /**
     * Initial field-array length for dense mode. Grows doubling as higher
     * refs are written. Ignored in sparse mode.
     */
    initialDenseModeCapacity?: number;
}

export class ComponentStore {
    readonly sparseSet: SparseSet;
    readonly mode: ComponentStorageMode;

    private readonly _fields: readonly FieldSpec[];
    private readonly _numeric: Map<string, TypedNumericArray> = new Map();
    private readonly _ref: Map<string, { index: Uint32Array; generation: Uint32Array }> =
        new Map();
    private readonly _side: Map<string, SideTable<unknown>> = new Map();

    /**
     * Parallel arrays of the stored field containers — maintained alongside
     * the name-keyed maps so `remove()` can iterate without allocating a
     * fresh `Map.values()` iterator on every call. Indices match the
     * per-kind order in which fields were first registered.
     */
    private readonly _numericArrs: TypedNumericArray[] = [];
    private readonly _refPairs: { index: Uint32Array; generation: Uint32Array }[] = [];
    private readonly _sideTables: SideTable<unknown>[] = [];

    /**
     * Length of every field array. In sparse mode, equals the sparse set's
     * dense capacity. In dense mode, grows to cover the highest ref ever
     * written. Independently tracked so each mode can manage growth.
     */
    private _fieldCapacity: number;

    /**
     * Monotonic counter bumped on every structural change (`add` / `remove`).
     * Queries compare this to their cached snapshot to know when to rebuild.
     */
    private _structuralVersion = 0;

    /**
     * Cached view object, built lazily on first {@link view} call and mutated
     * in place on field-array growth. Returning the same object every call
     * makes `view()` effectively free — no allocation, no re-iteration over
     * field definitions.
     */
    private _cachedView: Record<string, unknown> | null = null;

    constructor(fields: readonly FieldSpec[], opts: ComponentStoreExtendedOptions = {}) {
        this.mode = opts.mode ?? 'sparse';
        this._fields = fields;

        this.sparseSet = new SparseSet(
            opts.initialDenseCapacity ?? DEFAULT_DENSE_CAPACITY,
            opts.initialSparseCapacity ?? DEFAULT_SPARSE_CAPACITY,
        );

        this._fieldCapacity =
            this.mode === 'dense'
                ? Math.max(1, opts.initialDenseModeCapacity ?? DEFAULT_DENSE_MODE_FIELD_CAPACITY)
                : this.sparseSet.denseCapacity;

        for (const field of fields) this._allocField(field, this._fieldCapacity);
    }

    /** Number of entities currently holding this component. */
    get count(): number {
        return this.sparseSet.count;
    }

    /** Current capacity of each parallel field array. */
    get fieldCapacity(): number {
        return this._fieldCapacity;
    }

    /** Back-compat alias of {@link fieldCapacity}. */
    get denseCapacity(): number {
        return this._fieldCapacity;
    }

    /** The field layout this store was constructed with. */
    get fields(): readonly FieldSpec[] {
        return this._fields;
    }

    /** Counter that increments on every `add` / `remove`. */
    get structuralVersion(): number {
        return this._structuralVersion;
    }

    /**
     * Attach the component to `ref`.
     *
     * @returns The field-array index to use for subsequent writes.
     *   - sparse mode: the dense slot the sparse-set assigned.
     *   - dense mode:  `ref` itself (field arrays are indexed by ref).
     *
     * If the component was already present, the returned value is the current
     * index (no structural change, no version bump).
     */
    add(ref: EntityRef): number {
        const alreadyHad = this.sparseSet.has(ref);
        const denseIdx = this.sparseSet.add(ref, this._onDenseGrow);

        if (this.mode === 'dense') {
            if (ref >= this._fieldCapacity) this._growFieldsTo(ref + 1);
            if (!alreadyHad) this._structuralVersion++;
            return ref;
        }

        if (!alreadyHad) this._structuralVersion++;
        return denseIdx;
    }

    /** Detach the component from `ref`. Returns `true` if it was present. */
    remove(ref: EntityRef): boolean {
        const result = this.sparseSet.remove(ref);
        if (result === null) return false;

        if (this.mode === 'sparse') {
            const { removedIndex, movedRef } = result;
            if (movedRef !== null) {
                // Swap-and-pop: copy last dense row into the vacated slot.
                // Iterate parallel arrays directly — no Map.values() iterator alloc.
                const lastIndex = this.sparseSet.count;
                const numerics = this._numericArrs;
                for (let i = 0; i < numerics.length; i++) {
                    const arr = numerics[i]!;
                    arr[removedIndex] = arr[lastIndex]!;
                }
                const refs = this._refPairs;
                for (let i = 0; i < refs.length; i++) {
                    const pair = refs[i]!;
                    pair.index[removedIndex] = pair.index[lastIndex]!;
                    pair.generation[removedIndex] = pair.generation[lastIndex]!;
                }
            }
        }
        // Dense mode: field data at `ref` is now stale, but `has(ref)` is false
        // so it can't be observed. It will be overwritten on the next add(ref).

        // Side tables are keyed by entity ref in both modes.
        const sides = this._sideTables;
        for (let i = 0; i < sides.length; i++) sides[i]!.delete(ref);

        this._structuralVersion++;
        return true;
    }

    has(ref: EntityRef): boolean {
        return this.sparseSet.has(ref);
    }

    /**
     * Field-array index for `ref`, or `-1` if the component is not attached.
     *
     *  - sparse: returns the dense slot.
     *  - dense: returns `ref` itself.
     */
    indexOf(ref: EntityRef): number {
        if (this.mode === 'dense') {
            return this.sparseSet.has(ref) ? ref : -1;
        }
        return this.sparseSet.indexOf(ref);
    }

    /**
     * Typed view over this component's storage. Returns the **same object
     * reference** on every call — cached lazily on first access and mutated
     * in place when field arrays reallocate during growth.
     *
     * The object shape is `{ store, sparseSet, ...fieldArraysByName }`. Field
     * entries are typed-array references (numeric / `bool`), `RefFieldArrays`
     * pairs (`ref`), or {@link SideTable} instances (`side`).
     *
     * Safe to cache across ticks: the returned view object itself is stable
     * for the store's lifetime, and its field slots are refreshed in place
     * when growth happens. No per-call allocation.
     */
    view(): Record<string, unknown> {
        if (this._cachedView === null) this._cachedView = this._buildView();
        return this._cachedView;
    }

    /** Get the numeric field array. Throws if the field is missing or not numeric. */
    numericField(name: string): TypedNumericArray {
        const arr = this._numeric.get(name);
        if (arr === undefined) {
            throw new Error(`[nvx-ecs] numeric field "${name}" not defined on this component`);
        }
        return arr;
    }

    /** Get the ref-field arrays (index + generation). Throws if the field is missing or not a ref. */
    refField(name: string): RefFieldArrays {
        const pair = this._ref.get(name);
        if (pair === undefined) {
            throw new Error(`[nvx-ecs] ref field "${name}" not defined on this component`);
        }
        return pair;
    }

    /** Get the side table for a `side` field. Throws if the field is missing or not a side. */
    sideField<T>(name: string): SideTable<T> {
        const table = this._side.get(name);
        if (table === undefined) {
            throw new Error(`[nvx-ecs] side field "${name}" not defined on this component`);
        }
        return table as SideTable<T>;
    }

    /** Build a fresh view object. Called once on first `view()` access. */
    private _buildView(): Record<string, unknown> {
        const view: Record<string, unknown> = {
            store: this,
            sparseSet: this.sparseSet,
        };
        for (const field of this._fields) {
            if (field.kind === 'ref') {
                view[field.name] = this.refField(field.name);
            } else if (field.kind === 'side') {
                view[field.name] = this.sideField(field.name);
            } else {
                view[field.name] = this.numericField(field.name);
            }
        }
        return view;
    }

    private _allocField(field: FieldSpec, capacity: number): void {
        const storeNumeric = (arr: TypedNumericArray): void => {
            this._numeric.set(field.name, arr);
            this._numericArrs.push(arr);
        };
        switch (field.kind) {
            case 'f32':
                storeNumeric(new Float32Array(capacity));
                return;
            case 'f64':
                storeNumeric(new Float64Array(capacity));
                return;
            case 'i8':
                storeNumeric(new Int8Array(capacity));
                return;
            case 'u8':
            case 'bool':
                storeNumeric(new Uint8Array(capacity));
                return;
            case 'i16':
                storeNumeric(new Int16Array(capacity));
                return;
            case 'u16':
                storeNumeric(new Uint16Array(capacity));
                return;
            case 'i32':
                storeNumeric(new Int32Array(capacity));
                return;
            case 'u32':
                storeNumeric(new Uint32Array(capacity));
                return;
            case 'ref': {
                const pair = {
                    index: new Uint32Array(capacity),
                    generation: new Uint32Array(capacity),
                };
                this._ref.set(field.name, pair);
                this._refPairs.push(pair);
                return;
            }
            case 'side': {
                const table = new SideTable();
                this._side.set(field.name, table);
                this._sideTables.push(table);
                return;
            }
            default: {
                const exhaustive: never = field.kind;
                throw new Error(`[nvx-ecs] unknown field kind: ${String(exhaustive)}`);
            }
        }
    }

    /** Callback attached to `sparseSet.add`. Only sparse mode needs to mirror dense growth. */
    private readonly _onDenseGrow = (newCapacity: number): void => {
        if (this.mode === 'dense') return;
        this._growFieldsTo(newCapacity);
    };

    private _growFieldsTo(minCapacity: number): void {
        if (minCapacity <= this._fieldCapacity) return;
        let next = this._fieldCapacity * GROWTH_FACTOR;
        while (next < minCapacity) next *= GROWTH_FACTOR;
        const view = this._cachedView;
        // Walk parallel field arrays by index so we can update both the
        // name-keyed map and the index-keyed array in one pass.
        const numericArrs = this._numericArrs;
        let numericIdx = 0;
        const refPairs = this._refPairs;
        let refIdx = 0;
        for (const field of this._fields) {
            if (field.kind === 'ref') {
                const pair = refPairs[refIdx]!;
                const newPair = {
                    index: growTypedArray(pair.index, next),
                    generation: growTypedArray(pair.generation, next),
                };
                refPairs[refIdx] = newPair;
                refIdx++;
                this._ref.set(field.name, newPair);
                if (view !== null) view[field.name] = newPair;
            } else if (field.kind !== 'side') {
                const arr = numericArrs[numericIdx]!;
                const grown = growTypedArray(arr, next);
                numericArrs[numericIdx] = grown;
                numericIdx++;
                this._numeric.set(field.name, grown);
                if (view !== null) view[field.name] = grown;
            }
        }
        this._fieldCapacity = next;
    }
}

/** Forced type re-export so consumers can use `FieldKind` without a deep import. */
export type { FieldKind, FieldSpec };
