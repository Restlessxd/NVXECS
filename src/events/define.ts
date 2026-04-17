/**
 * {@link defineEvent} — user-facing factory for event schemas.
 *
 * Symmetric to {@link defineComponent}: returns a frozen, world-agnostic
 * descriptor that is later registered with a specific world's
 * {@link EventBus}.
 */

import type { EventDef } from './types.js';
import type { FieldMap } from '../schema/types.js';

export interface DefineEventInput<F extends FieldMap> {
    /** Human-readable name, used in errors and debug output. */
    readonly name: string;
    /** Field declarations — same vocabulary as `defineComponent`. */
    readonly fields: F;
}

/**
 * Declare an event channel. Returns a frozen descriptor suitable for
 * {@link World.registerEvent}.
 *
 * @example
 * ```ts
 * const DamageEvent = defineEvent({
 *     name: 'damage',
 *     fields: { target: 'ref', amount: 'f32', source: 'ref' },
 * });
 *
 * world.registerEvent(DamageEvent);
 *
 * // producer system
 * world.emit(DamageEvent, { target, amount: 10, source: attacker });
 *
 * // consumer system
 * const view = world.readEvents(DamageEvent);
 * for (let i = 0; i < view.count; i++) {
 *     const targetRef = view.target.index[i];
 *     const dmg = view.amount[i];
 * }
 * ```
 */
export function defineEvent<F extends FieldMap>(input: DefineEventInput<F>): EventDef<F> {
    return Object.freeze({
        name: input.name,
        fields: Object.freeze({ ...input.fields }),
    });
}
