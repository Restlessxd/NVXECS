import { describe, expect, it, vi } from 'vitest';
import { World } from '../../src/core/world.js';
import { defineComponent } from '../../src/schema/define.js';
import { System } from '../../src/system/system.js';
import { Scheduler, topoSort } from '../../src/system/scheduler.js';
import type { SystemContext } from '../../src/system/types.js';

// ─── Fixtures ─────────────────────────────────────────────────────────────
const Position = defineComponent({ name: 'Position', fields: { x: 'f32', y: 'f32' } });
const Velocity = defineComponent({ name: 'Velocity', fields: { vx: 'f32', vy: 'f32' } });
const Health = defineComponent({ name: 'Health', fields: { current: 'i32' } });

function makeWorld(): World {
    const w = new World();
    w.register(Position);
    w.register(Velocity);
    w.register(Health);
    return w;
}

class NoopSystem extends System {
    readonly name: string;
    override readonly reads: readonly ReturnType<typeof defineComponent>[];
    override readonly writes: readonly ReturnType<typeof defineComponent>[];
    override readonly stage: string;
    public ticks: number[] = [];
    public initCalls = 0;
    public destroyCalls = 0;
    public onUpdate?: (world: World, ctx: SystemContext) => void;

    constructor(
        name: string,
        opts: {
            reads?: readonly ReturnType<typeof defineComponent>[];
            writes?: readonly ReturnType<typeof defineComponent>[];
            stage?: string;
        } = {},
    ) {
        super();
        this.name = name;
        this.reads = opts.reads ?? [];
        this.writes = opts.writes ?? [];
        this.stage = opts.stage ?? 'update';
    }

    override init(): void {
        this.initCalls++;
    }

    override update(world: World, ctx: SystemContext): void {
        this.ticks.push(ctx.tick);
        this.onUpdate?.(world, ctx);
    }

    override destroy(): void {
        this.destroyCalls++;
    }
}

// ─── topoSort ──────────────────────────────────────────────────────────────

describe('topoSort', () => {
    it('returns an empty list for no systems', () => {
        expect(topoSort([])).toEqual([]);
    });

    it('returns a single system unchanged', () => {
        const a = new NoopSystem('A');
        expect(topoSort([a])).toEqual([a]);
    });

    it('orders a writer before a reader of the same component', () => {
        const writer = new NoopSystem('W', { writes: [Position] });
        const reader = new NoopSystem('R', { reads: [Position] });
        // Even if the reader was registered first, the writer should still run first.
        const result = topoSort([reader, writer]);
        expect(result.map((s) => s.name)).toEqual(['W', 'R']);
    });

    it('keeps independent systems in registration order', () => {
        const a = new NoopSystem('A', { writes: [Position] });
        const b = new NoopSystem('B', { writes: [Velocity] });
        const c = new NoopSystem('C', { writes: [Health] });
        const result = topoSort([a, b, c]);
        expect(result.map((s) => s.name)).toEqual(['A', 'B', 'C']);
    });

    it('is stable when two writers touch the same component', () => {
        const a = new NoopSystem('A', { writes: [Position] });
        const b = new NoopSystem('B', { writes: [Position] });
        // A is registered first, so A should run before B.
        const result = topoSort([a, b]);
        expect(result.map((s) => s.name)).toEqual(['A', 'B']);
    });

    it('detects and rejects cyclic read/write dependencies', () => {
        const a = new NoopSystem('A', { reads: [Position], writes: [Velocity] });
        const b = new NoopSystem('B', { reads: [Velocity], writes: [Position] });
        expect(() => topoSort([a, b])).toThrow(/cyclic/i);
    });
});

// ─── Scheduler registration ────────────────────────────────────────────────

describe('Scheduler', () => {
    describe('register / unregister', () => {
        it('calls init() on register and destroy() on unregister', () => {
            const w = makeWorld();
            const s = new NoopSystem('S');
            w.registerSystem(s);
            expect(s.initCalls).toBe(1);
            expect(w.unregisterSystem('S')).toBe(true);
            expect(s.destroyCalls).toBe(1);
            expect(w.unregisterSystem('S')).toBe(false); // already gone
        });

        it('rejects duplicate system names', () => {
            const w = makeWorld();
            w.registerSystem(new NoopSystem('Dup'));
            expect(() => w.registerSystem(new NoopSystem('Dup'))).toThrow(/already registered/);
        });

        it('rejects unknown stages', () => {
            const w = makeWorld();
            expect(() =>
                w.registerSystem(new NoopSystem('Bad', { stage: 'ghost-stage' })),
            ).toThrow(/unknown stage/);
        });

        it('has() and get() expose registered systems', () => {
            const w = makeWorld();
            const s = new NoopSystem('S');
            w.registerSystem(s);
            expect(w.scheduler.has('S')).toBe(true);
            expect(w.scheduler.get('S')).toBe(s);
        });
    });

    describe('custom stage order', () => {
        it('executes stages in the configured order', () => {
            const order: string[] = [];
            const w = new World({ scheduler: { stages: ['input', 'update', 'network'] } });
            w.registerSystem(
                Object.assign(new NoopSystem('InSys', { stage: 'input' }), {
                    onUpdate: () => order.push('input'),
                }),
            );
            w.registerSystem(
                Object.assign(new NoopSystem('UpdSys', { stage: 'update' }), {
                    onUpdate: () => order.push('update'),
                }),
            );
            w.registerSystem(
                Object.assign(new NoopSystem('NetSys', { stage: 'network' }), {
                    onUpdate: () => order.push('network'),
                }),
            );
            w.tick(0.016);
            expect(order).toEqual(['input', 'update', 'network']);
        });
    });

    describe('topo sort across registrations', () => {
        it('runs writer before reader regardless of registration order', () => {
            const w = makeWorld();
            const ran: string[] = [];

            const reader = new NoopSystem('R', { reads: [Position] });
            reader.onUpdate = () => ran.push('R');
            const writer = new NoopSystem('W', { writes: [Position] });
            writer.onUpdate = () => ran.push('W');

            // Register reader first to exercise the reordering.
            w.registerSystem(reader);
            w.registerSystem(writer);

            w.tick(0.016);
            expect(ran).toEqual(['W', 'R']);
        });

        it('detects a cycle on registration of the second system', () => {
            const w = makeWorld();
            w.registerSystem(new NoopSystem('A', { reads: [Position], writes: [Velocity] }));
            expect(() =>
                w.registerSystem(
                    new NoopSystem('B', { reads: [Velocity], writes: [Position] }),
                ),
            ).toThrow(/cyclic/i);
        });
    });

    describe('tick lifecycle', () => {
        it('increments the tick counter and feeds dt into ctx', () => {
            const w = makeWorld();
            const s = new NoopSystem('S');
            const dts: number[] = [];
            const ticks: number[] = [];
            s.onUpdate = (_, ctx) => {
                dts.push(ctx.dt);
                ticks.push(ctx.tick);
            };
            w.registerSystem(s);

            w.tick(0.1);
            w.tick(0.2);
            w.tick(0.3);

            expect(dts).toEqual([0.1, 0.2, 0.3]);
            expect(ticks).toEqual([0, 1, 2]);
        });

        it('flushes pending destroys at end of tick', () => {
            const w = makeWorld();

            class DestroyerSystem extends System {
                readonly name = 'Destroyer';
                override readonly writes = [Position];
                update(world: World): void {
                    // Destroy every entity that has Position on this tick.
                    const { sparseSet } = world.view(Position);
                    const refs: number[] = [];
                    for (let i = 0; i < sparseSet.count; i++) refs.push(sparseSet.dense[i]!);
                    for (const ref of refs) {
                        world.destroyEntity({ ref, gen: world.generationOf(ref) });
                    }
                }
            }

            const e1 = w.createEntity();
            const e2 = w.createEntity();
            w.add(e1, Position, { x: 0, y: 0 });
            w.add(e2, Position, { x: 0, y: 0 });

            w.registerSystem(new DestroyerSystem());

            expect(w.aliveEntityCount).toBe(2);
            w.tick(0.016);
            // After tick: destroys queued by the system should have been flushed.
            expect(w.aliveEntityCount).toBe(0);
            expect(w.view(Position).sparseSet.count).toBe(0);
        });

        it('does not allocate a new ctx object per system call', () => {
            const w = makeWorld();
            const seen: SystemContext[] = [];
            const s = new NoopSystem('S');
            s.onUpdate = (_, ctx) => seen.push(ctx);
            w.registerSystem(s);
            w.tick(0.016);
            w.tick(0.016);
            // Same ctx reference across ticks — scheduler mutates in place.
            expect(seen.length).toBe(2);
            expect(seen[0]).toBe(seen[1]);
        });
    });

    describe('hot reload (replace)', () => {
        it('swaps a system in place, preserving world state', () => {
            const w = makeWorld();
            const e = w.createEntity();
            w.add(e, Position, { x: 1, y: 2 });

            const oldDestroy = vi.fn();
            const newInit = vi.fn();
            const seenByOld: number[] = [];
            const seenByNew: number[] = [];

            const oldSys = new NoopSystem('TargetSys');
            oldSys.onUpdate = (_, ctx) => seenByOld.push(ctx.tick);
            oldSys.destroy = () => oldDestroy();
            w.registerSystem(oldSys);

            w.tick(0.016); // old system runs at tick 0
            expect(seenByOld).toEqual([0]);

            const newSys = new NoopSystem('TargetSys');
            newSys.onUpdate = (_, ctx) => seenByNew.push(ctx.tick);
            newSys.init = () => newInit();
            expect(w.replaceSystem('TargetSys', newSys)).toBe(true);
            expect(oldDestroy).toHaveBeenCalledOnce();
            expect(newInit).toHaveBeenCalledOnce();

            w.tick(0.016); // new system runs at tick 1
            expect(seenByNew).toEqual([1]);
            // World data survived the swap.
            expect(w.has(e, Position)).toBe(true);
        });

        it('rejects a replacement with a different name', () => {
            const w = makeWorld();
            w.registerSystem(new NoopSystem('A'));
            expect(() => w.replaceSystem('A', new NoopSystem('B'))).toThrow(/does not match/);
        });

        it('returns false when the named system is not registered', () => {
            const w = makeWorld();
            expect(w.replaceSystem('NotThere', new NoopSystem('NotThere'))).toBe(false);
        });
    });

    describe('destroyAll', () => {
        it('invokes destroy() on every system and clears the registry', () => {
            const w = makeWorld();
            const a = new NoopSystem('A');
            const b = new NoopSystem('B');
            w.registerSystem(a);
            w.registerSystem(b);
            w.scheduler.destroyAll();
            expect(a.destroyCalls).toBe(1);
            expect(b.destroyCalls).toBe(1);
            expect(w.scheduler.systemCount).toBe(0);
        });
    });

    describe('standalone Scheduler instance', () => {
        it('can be used without the World shortcut', () => {
            const w = makeWorld();
            const sch = new Scheduler(w, { stages: ['update'] });
            const s = new NoopSystem('S');
            sch.register(s);
            sch.tick(0.016);
            expect(s.ticks).toEqual([0]);
        });
    });
});
