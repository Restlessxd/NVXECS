import { describe, expect, it } from 'vitest';
import { SideTable } from '../../src/storage/side-table.js';

describe('SideTable', () => {
    it('starts empty', () => {
        const t = new SideTable<string>();
        expect(t.size).toBe(0);
        expect(t.has(1)).toBe(false);
        expect(t.get(1)).toBeUndefined();
    });

    it('stores and retrieves values', () => {
        const t = new SideTable<string>();
        t.set(1, 'hello');
        t.set(2, 'world');
        expect(t.get(1)).toBe('hello');
        expect(t.get(2)).toBe('world');
        expect(t.size).toBe(2);
    });

    it('overwrites existing values on set', () => {
        const t = new SideTable<number>();
        t.set(1, 10);
        t.set(1, 20);
        expect(t.get(1)).toBe(20);
        expect(t.size).toBe(1);
    });

    it('removes via delete', () => {
        const t = new SideTable<number>();
        t.set(1, 10);
        expect(t.delete(1)).toBe(true);
        expect(t.delete(1)).toBe(false); // already gone
        expect(t.has(1)).toBe(false);
    });

    it('clears all entries', () => {
        const t = new SideTable<number>();
        t.set(1, 1);
        t.set(2, 2);
        t.clear();
        expect(t.size).toBe(0);
        expect(t.has(1)).toBe(false);
    });

    it('iterates via entries()', () => {
        const t = new SideTable<string>();
        t.set(1, 'a');
        t.set(2, 'b');
        const seen: Array<[number, string]> = [];
        for (const entry of t.entries()) seen.push(entry);
        expect(seen).toEqual([
            [1, 'a'],
            [2, 'b'],
        ]);
    });
});
