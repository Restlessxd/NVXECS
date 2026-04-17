import { describe, expect, it } from 'vitest';
import { defineComponent } from '../../src/schema/define.js';
import { ComponentRegistry } from '../../src/schema/registry.js';

const Position = defineComponent({
    name: 'Position',
    fields: { x: 'f32', y: 'f32' },
});

const Health = defineComponent({
    name: 'Health',
    fields: { current: 'i32', max: 'i32' },
});

const Flag = defineComponent({
    name: 'Flag',
    fields: { active: 'bool' },
});

const Targeting = defineComponent({
    name: 'Targeting',
    fields: { target: 'ref' },
});

const Inventory = defineComponent({
    name: 'Inventory',
    fields: { items: 'side' },
});

describe('ComponentRegistry', () => {
    describe('register', () => {
        it('assigns sequential ids starting at 0', () => {
            const r = new ComponentRegistry(16);
            expect(r.register(Position)).toBe(0);
            expect(r.register(Health)).toBe(1);
            expect(r.register(Flag)).toBe(2);
        });

        it('is idempotent', () => {
            const r = new ComponentRegistry(16);
            const id1 = r.register(Position);
            const id2 = r.register(Position);
            expect(id1).toBe(id2);
            expect(r.componentCount).toBe(1);
        });

        it('tracks registration state', () => {
            const r = new ComponentRegistry(16);
            expect(r.isRegistered(Position)).toBe(false);
            r.register(Position);
            expect(r.isRegistered(Position)).toBe(true);
        });

        it('throws idOf for unregistered components', () => {
            const r = new ComponentRegistry(16);
            expect(() => r.idOf(Position)).toThrow(/Position.*not registered/);
        });
    });

    describe('add / remove / has', () => {
        it('adds and retrieves a component', () => {
            const r = new ComponentRegistry(16);
            r.register(Position);
            r.add(0, Position, { x: 1.5, y: 2.5 });

            expect(r.has(0, Position)).toBe(true);
            const view = r.view(Position);
            expect(view.x[0]).toBeCloseTo(1.5);
            expect(view.y[0]).toBeCloseTo(2.5);
        });

        it('has returns false for unregistered components without throwing', () => {
            const r = new ComponentRegistry(16);
            expect(r.has(0, Position)).toBe(false);
        });

        it('removes a component and clears the bitmask bit', () => {
            const r = new ComponentRegistry(16);
            r.register(Position);
            r.add(0, Position, { x: 1, y: 2 });
            expect(r.remove(0, Position)).toBe(true);
            expect(r.has(0, Position)).toBe(false);
            expect(r.remove(0, Position)).toBe(false); // already gone
        });

        it('bitmask reflects membership across multiple components', () => {
            const r = new ComponentRegistry(16);
            r.register(Position);
            r.register(Health);
            r.add(5, Position, { x: 0, y: 0 });
            r.add(5, Health, { current: 10, max: 20 });
            expect(r.bitmask.has(5, r.idOf(Position))).toBe(true);
            expect(r.bitmask.has(5, r.idOf(Health))).toBe(true);
            r.remove(5, Health);
            expect(r.bitmask.has(5, r.idOf(Position))).toBe(true);
            expect(r.bitmask.has(5, r.idOf(Health))).toBe(false);
        });
    });

    describe('init value handling', () => {
        it('applies numeric init values', () => {
            const r = new ComponentRegistry(16);
            r.register(Health);
            r.add(0, Health, { current: 50, max: 100 });
            const view = r.view(Health);
            expect(view.current[0]).toBe(50);
            expect(view.max[0]).toBe(100);
        });

        it('converts bool init (true/false/0/1) into 0/1', () => {
            const r = new ComponentRegistry(16);
            r.register(Flag);
            r.add(0, Flag, { active: true });
            r.add(1, Flag, { active: false });
            r.add(2, Flag, { active: 1 });
            r.add(3, Flag, { active: 0 });
            const view = r.view(Flag);
            expect(view.active[0]).toBe(1);
            expect(view.active[1]).toBe(0);
            expect(view.active[2]).toBe(1);
            expect(view.active[3]).toBe(0);
        });

        it('stores ref fields as (index, generation) pairs', () => {
            const r = new ComponentRegistry(16);
            r.register(Targeting);
            r.add(0, Targeting, { target: { ref: 7, gen: 3 } });
            const view = r.view(Targeting);
            expect(view.target.index[0]).toBe(7);
            expect(view.target.generation[0]).toBe(3);
        });

        it('routes side-field init values into the side table', () => {
            const r = new ComponentRegistry(16);
            r.register(Inventory);
            const items = ['apple', 'rock'];
            r.add(0, Inventory, { items });
            expect(r.view(Inventory).items.get(0)).toBe(items);
        });

        it('leaves omitted fields at zero-init defaults', () => {
            const r = new ComponentRegistry(16);
            r.register(Position);
            r.add(0, Position); // no init at all
            const view = r.view(Position);
            expect(view.x[0]).toBe(0);
            expect(view.y[0]).toBe(0);
        });
    });

    describe('view', () => {
        it('returns the same field arrays the store holds', () => {
            const r = new ComponentRegistry(16);
            r.register(Position);
            const store = r.storeOf(Position);
            const view = r.view(Position);
            expect(view.store).toBe(store);
            expect(view.sparseSet).toBe(store.sparseSet);
            expect(view.x).toBe(store.numericField('x'));
            expect(view.y).toBe(store.numericField('y'));
        });
    });

    describe('removeAll', () => {
        it('clears every component for an entity', () => {
            const r = new ComponentRegistry(16);
            r.register(Position);
            r.register(Health);
            r.register(Flag);
            r.add(3, Position, { x: 0, y: 0 });
            r.add(3, Health, { current: 10, max: 10 });
            r.add(3, Flag, { active: true });

            r.removeAll(3);
            expect(r.has(3, Position)).toBe(false);
            expect(r.has(3, Health)).toBe(false);
            expect(r.has(3, Flag)).toBe(false);
            expect(r.storeOf(Position).count).toBe(0);
            expect(r.storeOf(Health).count).toBe(0);
            expect(r.storeOf(Flag).count).toBe(0);
        });

        it('does not affect other entities', () => {
            const r = new ComponentRegistry(16);
            r.register(Position);
            r.add(1, Position, { x: 1, y: 1 });
            r.add(2, Position, { x: 2, y: 2 });
            r.removeAll(1);
            expect(r.has(2, Position)).toBe(true);
        });
    });
});
