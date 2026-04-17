/**
 * Event-layer type definitions.
 *
 * An "event" is a dense, numerically-indexed record emitted by one system
 * and consumed by others within the same tick. Events reuse the
 * {@link FieldKind} vocabulary from components so the same numeric / ref /
 * side-field machinery carries over — only the storage shape differs (no
 * sparse indexing; events are a plain append buffer that's flushed at the
 * end of every tick).
 */

import type { RefFieldArrays } from '../storage/component-store.js';
import type { FieldKind } from '../storage/types.js';
import type {
    ComponentInit,
    FieldMap,
    NumericArrayFor,
    NumericFieldKind,
} from '../schema/types.js';

/** Frozen event descriptor. Produced by {@link defineEvent}. */
export interface EventDef<F extends FieldMap = FieldMap> {
    readonly name: string;
    readonly fields: F;
}

// ─── View type inference (mirrors ComponentView, minus sparseSet) ──────────

/** What the event view returns for a given field kind. */
export type EventViewField<K extends FieldKind> = K extends NumericFieldKind
    ? NumericArrayFor<K>
    : K extends 'ref'
      ? RefFieldArrays
      : K extends 'side'
        ? ReadonlyArray<unknown>
        : never;

/**
 * A typed view over an event channel's storage. `count` is the number of
 * events in the current tick buffer; field arrays are indexed `[0, count)`.
 *
 * Views are not reshaped — they just point at the current backing arrays.
 * Cache once per system init and re-read the `count` field every drain.
 */
export type EventView<F extends FieldMap> = {
    readonly count: number;
} & {
    readonly [K in keyof F]: EventViewField<F[K]>;
};

/** Shape of the payload accepted by {@link EventBus.emit}. */
export type EventInit<F extends FieldMap> = ComponentInit<F>;
