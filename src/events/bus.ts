/**
 * Per-world event bus.
 *
 * Holds one {@link EventChannel} per registered {@link EventDef}. Events
 * live for one tick by default — the {@link Scheduler} calls {@link clearAll}
 * at the end of every tick so fresh emits start from an empty buffer.
 *
 * Lifecycle within a tick:
 *  1. Producer systems call `bus.emit(Def, payload)` — append to channel.
 *  2. Consumer systems call `bus.read(Def)` — get a typed view of the buffer.
 *  3. After all systems in all stages run, scheduler invokes `bus.clearAll()`.
 *
 * Multi-read is supported: any number of systems may consume the same
 * event's buffer during a tick. Reads do not drain — only the end-of-tick
 * clear does.
 */

import { EventChannel } from './channel.js';
import type { EventDef, EventInit, EventView } from './types.js';
import type { FieldMap } from '../schema/types.js';
import type { FieldSpec } from '../storage/types.js';

export class EventBus {
    private readonly _channels = new Map<EventDef, EventChannel>();

    /**
     * Parallel array of registered channels — updated on every {@link register}
     * so the per-tick {@link clearAll} sweep can iterate without allocating a
     * fresh `Map.values()` iterator.
     */
    private readonly _channelsArr: EventChannel[] = [];

    /** Number of registered event types. */
    get channelCount(): number {
        return this._channels.size;
    }

    /**
     * Register an event definition. Re-registering the same def is idempotent;
     * a different def with the same name throws.
     */
    register(def: EventDef): EventChannel {
        const existing = this._channels.get(def);
        if (existing !== undefined) return existing;

        for (const other of this._channels.keys()) {
            if (other.name === def.name) {
                throw new Error(
                    `[nvx-ecs] event "${def.name}" already registered under a different descriptor`,
                );
            }
        }

        const specs: FieldSpec[] = [];
        for (const [name, kind] of Object.entries(def.fields)) {
            specs.push({ name, kind });
        }
        const channel = new EventChannel(specs);
        this._channels.set(def, channel);
        this._channelsArr.push(channel);
        return channel;
    }

    /** Is this event type registered? */
    isRegistered(def: EventDef): boolean {
        return this._channels.has(def);
    }

    /** Get the raw channel for a registered event. Throws if unregistered. */
    channelOf(def: EventDef): EventChannel {
        const ch = this._channels.get(def);
        if (ch === undefined) {
            throw new Error(`[nvx-ecs] event "${def.name}" is not registered with this world`);
        }
        return ch;
    }

    /** Append one event to the buffer. */
    emit<F extends FieldMap>(def: EventDef<F>, init?: EventInit<F>): void {
        this.channelOf(def).emit(init as Record<string, unknown> | undefined);
    }

    /**
     * Typed view over this event's current-tick buffer. Returns the **same
     * cached object** every call — zero allocation, zero `Object.entries`,
     * `count` updated in place by the channel on every emit and clear.
     */
    read<F extends FieldMap>(def: EventDef<F>): EventView<F> {
        return this.channelOf(def).view() as EventView<F>;
    }

    /** Drop every buffered event across every channel. Invoked by the scheduler each tick. */
    clearAll(): void {
        const arr = this._channelsArr;
        for (let i = 0; i < arr.length; i++) arr[i]!.clear();
    }

    /** Drop every buffered event for a single channel. */
    clear(def: EventDef): void {
        this.channelOf(def).clear();
    }
}
