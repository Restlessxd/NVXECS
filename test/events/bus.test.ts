import { describe, expect, it } from 'vitest';
import { World } from '../../src/core/world.js';
import { EventBus } from '../../src/events/bus.js';
import { defineEvent } from '../../src/events/define.js';
import { System } from '../../src/system/system.js';
import type { SystemContext } from '../../src/system/types.js';

const DamageEvent = defineEvent({
    name: 'damage',
    fields: { target: 'ref', amount: 'f32', source: 'ref' },
});

const SpawnEvent = defineEvent({
    name: 'spawn',
    fields: { kind: 'u8' },
});

const LogEvent = defineEvent({
    name: 'log',
    fields: { message: 'side', level: 'u8' },
});

describe('EventBus', () => {
    describe('register', () => {
        it('creates a channel for a fresh event', () => {
            const bus = new EventBus();
            expect(bus.isRegistered(DamageEvent)).toBe(false);
            bus.register(DamageEvent);
            expect(bus.isRegistered(DamageEvent)).toBe(true);
            expect(bus.channelCount).toBe(1);
        });

        it('is idempotent for the same descriptor', () => {
            const bus = new EventBus();
            const a = bus.register(DamageEvent);
            const b = bus.register(DamageEvent);
            expect(a).toBe(b);
            expect(bus.channelCount).toBe(1);
        });

        it('throws if a different descriptor shares a name', () => {
            const bus = new EventBus();
            const A = defineEvent({ name: 'dup', fields: { x: 'f32' } });
            const B = defineEvent({ name: 'dup', fields: { y: 'i32' } });
            bus.register(A);
            expect(() => bus.register(B)).toThrow(/already registered/);
        });

        it('throws channelOf/read/emit for unregistered events', () => {
            const bus = new EventBus();
            expect(() => bus.channelOf(DamageEvent)).toThrow(/not registered/);
            expect(() => bus.emit(DamageEvent, {})).toThrow(/not registered/);
        });
    });

    describe('emit + read', () => {
        it('buffers emits and exposes them via a typed view', () => {
            const bus = new EventBus();
            bus.register(DamageEvent);

            bus.emit(DamageEvent, { target: { ref: 1, gen: 1 }, amount: 10, source: { ref: 2, gen: 1 } });
            bus.emit(DamageEvent, { target: { ref: 3, gen: 2 }, amount: 20, source: { ref: 4, gen: 1 } });

            const view = bus.read(DamageEvent);
            expect(view.count).toBe(2);
            expect(view.amount[0]).toBe(10);
            expect(view.amount[1]).toBe(20);
            expect(view.target.index[0]).toBe(1);
            expect(view.target.index[1]).toBe(3);
            expect(view.source.index[1]).toBe(4);
        });

        it('view.count reflects subsequent emits without re-reading', () => {
            const bus = new EventBus();
            bus.register(SpawnEvent);
            const view = bus.read(SpawnEvent);
            expect(view.count).toBe(0);
            bus.emit(SpawnEvent, { kind: 1 });
            bus.emit(SpawnEvent, { kind: 2 });
            // Same view object, `count` is a live getter
            expect(view.count).toBe(2);
        });

        it('supports side-field payloads', () => {
            const bus = new EventBus();
            bus.register(LogEvent);
            bus.emit(LogEvent, { message: 'hello', level: 1 });
            bus.emit(LogEvent, { message: 'world', level: 2 });
            const view = bus.read(LogEvent);
            expect(view.count).toBe(2);
            expect(view.message[0]).toBe('hello');
            expect(view.message[1]).toBe('world');
            expect(view.level[0]).toBe(1);
            expect(view.level[1]).toBe(2);
        });
    });

    describe('clearAll / clear', () => {
        it('clearAll empties every registered channel', () => {
            const bus = new EventBus();
            bus.register(DamageEvent);
            bus.register(SpawnEvent);
            bus.emit(DamageEvent, { amount: 1 });
            bus.emit(SpawnEvent, { kind: 1 });
            bus.clearAll();
            expect(bus.read(DamageEvent).count).toBe(0);
            expect(bus.read(SpawnEvent).count).toBe(0);
        });

        it('clear(def) empties only the targeted channel', () => {
            const bus = new EventBus();
            bus.register(DamageEvent);
            bus.register(SpawnEvent);
            bus.emit(DamageEvent, { amount: 1 });
            bus.emit(SpawnEvent, { kind: 1 });
            bus.clear(DamageEvent);
            expect(bus.read(DamageEvent).count).toBe(0);
            expect(bus.read(SpawnEvent).count).toBe(1);
        });
    });
});

describe('EventBus + World + Scheduler integration', () => {
    it('clears every channel at the end of each tick automatically', () => {
        const world = new World();
        world.registerEvent(DamageEvent);

        class Producer extends System {
            readonly name = 'Producer';
            update(w: World): void {
                w.emit(DamageEvent, { amount: 1 });
            }
        }

        let seenCount = -1;
        class Consumer extends System {
            readonly name = 'Consumer';
            update(w: World): void {
                seenCount = w.readEvents(DamageEvent).count;
            }
        }

        world.registerSystem(new Producer());
        world.registerSystem(new Consumer());

        world.tick(0.016);
        // Consumer ran after producer within the same tick
        expect(seenCount).toBe(1);
        // Scheduler cleared at end of tick
        expect(world.readEvents(DamageEvent).count).toBe(0);

        world.tick(0.016);
        // Fresh emit, not cumulative across ticks
        expect(seenCount).toBe(1);
    });

    it('propagates data between systems within one tick', () => {
        const world = new World();
        world.registerEvent(DamageEvent);

        const damagesDealt: number[] = [];

        class Attacker extends System {
            readonly name = 'Attacker';
            update(w: World, _ctx: SystemContext): void {
                w.emit(DamageEvent, {
                    target: { ref: 1, gen: 1 },
                    amount: 7,
                    source: { ref: 0, gen: 1 },
                });
                w.emit(DamageEvent, {
                    target: { ref: 2, gen: 1 },
                    amount: 3,
                    source: { ref: 0, gen: 1 },
                });
            }
        }

        class Applier extends System {
            readonly name = 'Applier';
            update(w: World): void {
                const view = w.readEvents(DamageEvent);
                for (let i = 0; i < view.count; i++) damagesDealt.push(view.amount[i]!);
            }
        }

        world.registerSystem(new Attacker());
        world.registerSystem(new Applier());
        world.tick(0.016);

        expect(damagesDealt).toEqual([7, 3]);
    });
});
