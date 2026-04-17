/**
 * Per-event-type storage: a growable SoA append buffer.
 *
 * The internal layout mirrors {@link ComponentStore} but without the sparse
 * set — events are addressed by their zero-based position in the buffer,
 * not by entity ref. Emit appends; {@link clear} resets the count. Backing
 * arrays are retained across ticks so repeated emit/clear cycles allocate
 * nothing.
 *
 * Side-field entries are stored in a plain `unknown[]`. On {@link clear}
 * the array entries are nulled out up to the old count so the GC can
 * reclaim whatever objects were held. Numeric / ref fields are typed
 * arrays — their stale values are simply overwritten on the next emit.
 */

import { growTypedArray } from '../utils/typed-array.js';
import type { EntityHandle } from '../types/index.js';
import type { FieldSpec } from '../storage/types.js';
import type { RefFieldArrays } from '../storage/component-store.js';
import type { TypedNumericArray } from '../utils/typed-array.js';

const DEFAULT_CAPACITY = 128;
const GROWTH_FACTOR = 2;

export class EventChannel {
    private readonly _fields: readonly FieldSpec[];
    private readonly _numeric: Map<string, TypedNumericArray> = new Map();
    private readonly _ref: Map<string, { index: Uint32Array; generation: Uint32Array }> =
        new Map();
    private readonly _side: Map<string, unknown[]> = new Map();
    private _capacity: number;
    private _count = 0;

    /**
     * Cached view object (`{ count, ...fields }`) returned from {@link view}.
     * Built lazily on first access and mutated in place on growth, so
     * `world.readEvents(def)` never allocates after the first call per tick.
     */
    private _cachedView: (Record<string, unknown> & { count: number }) | null = null;

    constructor(fields: readonly FieldSpec[], initialCapacity: number = DEFAULT_CAPACITY) {
        this._fields = fields;
        this._capacity = Math.max(1, initialCapacity);
        for (const field of fields) this._allocField(field, this._capacity);
    }

    /** Number of events currently buffered. */
    get count(): number {
        return this._count;
    }

    /** Current backing capacity; grows automatically as events are emitted. */
    get capacity(): number {
        return this._capacity;
    }

    /** The field layout this channel was constructed with. */
    get fields(): readonly FieldSpec[] {
        return this._fields;
    }

    /** Append an event. Writes any provided init values; omitted fields keep zeroes. */
    emit(init?: Record<string, unknown>): number {
        if (this._count >= this._capacity) this._grow();
        const index = this._count++;
        if (init !== undefined) this._applyInit(index, init);
        if (this._cachedView !== null) this._cachedView.count = this._count;
        return index;
    }

    /** Drop every event in the buffer. Backing arrays are kept for reuse. */
    clear(): void {
        // Null out side-field slots so their referents can be GC'd.
        if (this._side.size > 0 && this._count > 0) {
            for (const arr of this._side.values()) {
                for (let i = 0; i < this._count; i++) arr[i] = null;
            }
        }
        this._count = 0;
        if (this._cachedView !== null) this._cachedView.count = 0;
    }

    /**
     * Typed view over the channel's current buffer. Returns the **same
     * object reference** every call — cached lazily and mutated in place as
     * the buffer grows or the count changes. Zero allocation, safe to call
     * from hot paths.
     */
    view(): Record<string, unknown> & { count: number } {
        if (this._cachedView === null) this._cachedView = this._buildView();
        return this._cachedView;
    }

    private _buildView(): Record<string, unknown> & { count: number } {
        const view: Record<string, unknown> & { count: number } = { count: this._count };
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

    /** Numeric field access. Indexed `[0, count)`. */
    numericField(name: string): TypedNumericArray {
        const arr = this._numeric.get(name);
        if (arr === undefined) {
            throw new Error(`[nvx-ecs] numeric field "${name}" not defined on this event`);
        }
        return arr;
    }

    /** Ref field access. Parallel (index, generation) `Uint32Array`s. */
    refField(name: string): RefFieldArrays {
        const pair = this._ref.get(name);
        if (pair === undefined) {
            throw new Error(`[nvx-ecs] ref field "${name}" not defined on this event`);
        }
        return pair;
    }

    /** Side-field access. Plain array of values, indexed `[0, count)`. */
    sideField(name: string): ReadonlyArray<unknown> {
        const arr = this._side.get(name);
        if (arr === undefined) {
            throw new Error(`[nvx-ecs] side field "${name}" not defined on this event`);
        }
        return arr;
    }

    private _allocField(field: FieldSpec, capacity: number): void {
        switch (field.kind) {
            case 'f32':
                this._numeric.set(field.name, new Float32Array(capacity));
                return;
            case 'f64':
                this._numeric.set(field.name, new Float64Array(capacity));
                return;
            case 'i8':
                this._numeric.set(field.name, new Int8Array(capacity));
                return;
            case 'u8':
            case 'bool':
                this._numeric.set(field.name, new Uint8Array(capacity));
                return;
            case 'i16':
                this._numeric.set(field.name, new Int16Array(capacity));
                return;
            case 'u16':
                this._numeric.set(field.name, new Uint16Array(capacity));
                return;
            case 'i32':
                this._numeric.set(field.name, new Int32Array(capacity));
                return;
            case 'u32':
                this._numeric.set(field.name, new Uint32Array(capacity));
                return;
            case 'ref':
                this._ref.set(field.name, {
                    index: new Uint32Array(capacity),
                    generation: new Uint32Array(capacity),
                });
                return;
            case 'side':
                this._side.set(field.name, new Array<unknown>(capacity).fill(null));
                return;
            default: {
                const exhaustive: never = field.kind;
                throw new Error(`[nvx-ecs] unknown field kind: ${String(exhaustive)}`);
            }
        }
    }

    private _grow(): void {
        const next = this._capacity * GROWTH_FACTOR;
        const view = this._cachedView;

        for (const [name, arr] of this._numeric) {
            const grown = growTypedArray(arr, next);
            this._numeric.set(name, grown);
            if (view !== null) view[name] = grown;
        }
        for (const [name, pair] of this._ref) {
            const newPair = {
                index: growTypedArray(pair.index, next),
                generation: growTypedArray(pair.generation, next),
            };
            this._ref.set(name, newPair);
            if (view !== null) view[name] = newPair;
        }
        for (const [name, arr] of this._side) {
            arr.length = next; // holes are fine; we only access [0, count)
        }

        this._capacity = next;
    }

    private _applyInit(index: number, init: Record<string, unknown>): void {
        for (const field of this._fields) {
            const value = init[field.name];
            if (value === undefined) continue;

            switch (field.kind) {
                case 'f32':
                case 'f64':
                case 'i8':
                case 'u8':
                case 'i16':
                case 'u16':
                case 'i32':
                case 'u32':
                    this.numericField(field.name)[index] = value as number;
                    break;
                case 'bool':
                    this.numericField(field.name)[index] =
                        value === true || value === 1
                            ? 1
                            : value === false || value === 0
                              ? 0
                              : (value as number);
                    break;
                case 'ref': {
                    const handle = value as EntityHandle;
                    const pair = this.refField(field.name);
                    pair.index[index] = handle.ref;
                    pair.generation[index] = handle.gen;
                    break;
                }
                case 'side':
                    this._side.get(field.name)![index] = value;
                    break;
                default: {
                    const exhaustive: never = field.kind;
                    throw new Error(`[nvx-ecs] unknown field kind: ${String(exhaustive)}`);
                }
            }
        }
    }
}
