import { describe, expect, it } from 'vitest';
import { defineEvent } from '../../src/events/define.js';

describe('defineEvent', () => {
    it('returns a frozen descriptor', () => {
        const DamageEvent = defineEvent({
            name: 'damage',
            fields: { target: 'ref', amount: 'f32', source: 'ref' },
        });
        expect(DamageEvent.name).toBe('damage');
        expect(Object.isFrozen(DamageEvent)).toBe(true);
        expect(Object.isFrozen(DamageEvent.fields)).toBe(true);
    });

    it('does not share the input fields object', () => {
        const input = { name: 'e', fields: { x: 'f32' as const } };
        const e = defineEvent(input);
        expect(e.fields).not.toBe(input.fields);
    });
});
