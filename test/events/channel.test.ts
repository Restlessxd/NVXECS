import { describe, expect, it } from 'vitest';
import { EventChannel } from '../../src/events/channel.js';
import type { FieldSpec } from '../../src/storage/types.js';

const DAMAGE_FIELDS: FieldSpec[] = [
    { name: 'target', kind: 'ref' },
    { name: 'amount', kind: 'f32' },
    { name: 'critical', kind: 'bool' },
];

const INFO_FIELDS: FieldSpec[] = [
    { name: 'message', kind: 'side' },
    { name: 'severity', kind: 'u8' },
];

describe('EventChannel', () => {
    describe('emit + field access', () => {
        it('writes numeric, bool, and ref fields into parallel arrays', () => {
            const ch = new EventChannel(DAMAGE_FIELDS, 4);
            ch.emit({ target: { ref: 10, gen: 2 }, amount: 5.5, critical: true });
            ch.emit({ target: { ref: 20, gen: 3 }, amount: 8.5, critical: false });

            expect(ch.count).toBe(2);
            expect(ch.refField('target').index[0]).toBe(10);
            expect(ch.refField('target').generation[0]).toBe(2);
            expect(ch.refField('target').index[1]).toBe(20);
            expect(ch.numericField('amount')[0]).toBeCloseTo(5.5);
            expect(ch.numericField('amount')[1]).toBeCloseTo(8.5);
            expect(ch.numericField('critical')[0]).toBe(1);
            expect(ch.numericField('critical')[1]).toBe(0);
        });

        it('allows emit without an init — zero-initialized row', () => {
            const ch = new EventChannel(DAMAGE_FIELDS, 2);
            ch.emit();
            expect(ch.count).toBe(1);
            expect(ch.refField('target').index[0]).toBe(0);
            expect(ch.numericField('amount')[0]).toBe(0);
        });

        it('throws on access to an undefined field', () => {
            const ch = new EventChannel(DAMAGE_FIELDS);
            expect(() => ch.numericField('ghost')).toThrow(/numeric field "ghost"/);
            expect(() => ch.refField('ghost')).toThrow(/ref field "ghost"/);
            expect(() => ch.sideField('ghost')).toThrow(/side field "ghost"/);
        });
    });

    describe('clear', () => {
        it('resets count to zero', () => {
            const ch = new EventChannel(DAMAGE_FIELDS);
            ch.emit({ amount: 1 });
            ch.emit({ amount: 2 });
            ch.clear();
            expect(ch.count).toBe(0);
        });

        it('nulls out side-field entries up to the old count', () => {
            const ch = new EventChannel(INFO_FIELDS, 4);
            ch.emit({ message: 'hello', severity: 1 });
            ch.emit({ message: 'world', severity: 2 });
            const msgArr = ch.sideField('message') as unknown[];
            expect(msgArr[0]).toBe('hello');
            expect(msgArr[1]).toBe('world');
            ch.clear();
            expect(msgArr[0]).toBe(null);
            expect(msgArr[1]).toBe(null);
        });

        it('does not shrink backing storage', () => {
            const ch = new EventChannel(DAMAGE_FIELDS, 8);
            const before = ch.capacity;
            for (let i = 0; i < 5; i++) ch.emit();
            ch.clear();
            expect(ch.capacity).toBe(before);
        });
    });

    describe('growth', () => {
        it('doubles capacity when the buffer fills', () => {
            const ch = new EventChannel(DAMAGE_FIELDS, 2);
            ch.emit();
            ch.emit();
            expect(ch.capacity).toBe(2);
            ch.emit();
            expect(ch.capacity).toBe(4);
        });

        it('preserves existing values across growth', () => {
            const ch = new EventChannel(DAMAGE_FIELDS, 2);
            ch.emit({ amount: 1.5 });
            ch.emit({ amount: 2.5 });
            for (let i = 0; i < 20; i++) ch.emit({ amount: i });

            expect(ch.numericField('amount')[0]).toBeCloseTo(1.5);
            expect(ch.numericField('amount')[1]).toBeCloseTo(2.5);
        });

        it('grows ref-field arrays together with numerics', () => {
            const ch = new EventChannel(DAMAGE_FIELDS, 2);
            for (let i = 0; i < 10; i++) ch.emit({ target: { ref: i, gen: i + 1 } });
            const target = ch.refField('target');
            for (let i = 0; i < 10; i++) {
                expect(target.index[i]).toBe(i);
                expect(target.generation[i]).toBe(i + 1);
            }
        });

        it('grows side-field arrays as well', () => {
            const ch = new EventChannel(INFO_FIELDS, 2);
            for (let i = 0; i < 10; i++) ch.emit({ message: `m${i}`, severity: i });
            const msgs = ch.sideField('message') as unknown[];
            expect(msgs.length).toBeGreaterThanOrEqual(10);
            for (let i = 0; i < 10; i++) expect(msgs[i]).toBe(`m${i}`);
        });
    });
});
