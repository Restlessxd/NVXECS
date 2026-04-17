/**
 * Keyed-by-entity side table for reference-typed component fields.
 *
 * Used for data that doesn't fit in a SoA typed array: inventory item lists,
 * AI state objects, string labels, etc. Access is O(1) via a native `Map`.
 *
 * This is a thin wrapper so that future versions may swap in a more
 * specialized structure (e.g. dense object array indexed by entity slot)
 * without breaking call sites.
 */

import type { EntityRef } from '../types/index.js';

export class SideTable<T> {
    private readonly _data: Map<EntityRef, T> = new Map();

    /** Number of entities that currently have a value. */
    get size(): number {
        return this._data.size;
    }

    /** Set the value for `ref`, replacing any existing value. */
    set(ref: EntityRef, value: T): void {
        this._data.set(ref, value);
    }

    /** Retrieve the value for `ref`, or `undefined` if absent. */
    get(ref: EntityRef): T | undefined {
        return this._data.get(ref);
    }

    /** Does `ref` have a value in this table? */
    has(ref: EntityRef): boolean {
        return this._data.has(ref);
    }

    /** Remove the value for `ref`. Returns `true` if there was one. */
    delete(ref: EntityRef): boolean {
        return this._data.delete(ref);
    }

    /** Drop all entries. */
    clear(): void {
        this._data.clear();
    }

    /** Iterate `[ref, value]` pairs. */
    entries(): IterableIterator<[EntityRef, T]> {
        return this._data.entries();
    }
}
