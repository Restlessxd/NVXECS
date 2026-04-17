import { describe, expect, it } from 'vitest';
import { defineComponent } from '../../src/schema/define.js';

describe('defineComponent', () => {
    it('returns a frozen descriptor with the given name and fields', () => {
        const Position = defineComponent({
            name: 'Position',
            fields: { x: 'f32', y: 'f32' },
        });

        expect(Position.name).toBe('Position');
        expect(Position.fields.x).toBe('f32');
        expect(Position.fields.y).toBe('f32');
        expect(Object.isFrozen(Position)).toBe(true);
        expect(Object.isFrozen(Position.fields)).toBe(true);
    });

    it('does not share the field object with the input', () => {
        const input = { name: 'A', fields: { x: 'f32' as const } };
        const A = defineComponent(input);
        expect(A.fields).not.toBe(input.fields);
    });

    it('supports mixed field kinds', () => {
        const Mob = defineComponent({
            name: 'Mob',
            fields: {
                health: 'i32',
                alive: 'bool',
                target: 'ref',
                inventory: 'side',
            },
        });
        expect(Mob.fields.health).toBe('i32');
        expect(Mob.fields.alive).toBe('bool');
        expect(Mob.fields.target).toBe('ref');
        expect(Mob.fields.inventory).toBe('side');
    });
});
