import { describe, expect, it } from 'vitest';
import { buildComponentMask } from '../../src/query/matcher.js';

describe('buildComponentMask', () => {
    it('produces an all-zero mask for an empty id list', () => {
        const mask = buildComponentMask([], 2);
        expect(mask).toEqual(new Uint32Array(2));
    });

    it('sets the single bit for a component id within chunk 0', () => {
        const mask = buildComponentMask([5], 1);
        expect(mask[0]).toBe(1 << 5);
    });

    it('places bits in the correct chunk for high component ids', () => {
        const mask = buildComponentMask([3, 35, 64], 3);
        expect(mask[0]).toBe(1 << 3);
        expect(mask[1]).toBe(1 << (35 - 32));
        expect(mask[2]).toBe(1 << (64 - 64));
    });

    it('OR-combines multiple bits in the same chunk', () => {
        const mask = buildComponentMask([1, 3, 5], 1);
        expect(mask[0]).toBe((1 << 1) | (1 << 3) | (1 << 5));
    });

    it('ignores ids past the allocated chunks', () => {
        const mask = buildComponentMask([3, 100], 1); // 100 would land in chunk 3
        expect(mask[0]).toBe(1 << 3);
        expect(mask.length).toBe(1);
    });

    it('returns a Uint32Array of exactly chunksPerEntity length', () => {
        expect(buildComponentMask([], 1).length).toBe(1);
        expect(buildComponentMask([], 4).length).toBe(4);
    });
});
