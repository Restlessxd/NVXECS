import { describe, expect, it } from 'vitest';
import { EntityBitmask } from '../../src/storage/bitmask.js';

describe('EntityBitmask', () => {
    describe('basic set / clear / has', () => {
        it('starts with every bit clear', () => {
            const bm = new EntityBitmask(16);
            expect(bm.has(0, 0)).toBe(false);
            expect(bm.has(5, 31)).toBe(false);
        });

        it('remembers a set bit', () => {
            const bm = new EntityBitmask(16);
            bm.set(3, 10);
            expect(bm.has(3, 10)).toBe(true);
        });

        it('clears a single bit without disturbing neighbors', () => {
            const bm = new EntityBitmask(16);
            bm.set(3, 5);
            bm.set(3, 6);
            bm.set(3, 7);
            bm.clear(3, 6);
            expect(bm.has(3, 5)).toBe(true);
            expect(bm.has(3, 6)).toBe(false);
            expect(bm.has(3, 7)).toBe(true);
        });

        it('distinguishes entities with the same component', () => {
            const bm = new EntityBitmask(16);
            bm.set(1, 3);
            bm.set(2, 3);
            bm.clear(1, 3);
            expect(bm.has(1, 3)).toBe(false);
            expect(bm.has(2, 3)).toBe(true);
        });
    });

    describe('clearAll', () => {
        it('zeroes every chunk for a single entity', () => {
            const bm = new EntityBitmask(16, 2); // 64 components
            for (let c = 0; c < 64; c++) bm.set(5, c);
            bm.clearAll(5);
            for (let c = 0; c < 64; c++) {
                expect(bm.has(5, c)).toBe(false);
            }
        });

        it("doesn't touch other entities", () => {
            const bm = new EntityBitmask(16);
            bm.set(1, 10);
            bm.set(2, 10);
            bm.clearAll(1);
            expect(bm.has(1, 10)).toBe(false);
            expect(bm.has(2, 10)).toBe(true);
        });
    });

    describe('growEntities', () => {
        it('automatically grows when a high entity ref is written', () => {
            const bm = new EntityBitmask(4);
            expect(bm.entityCapacity).toBe(4);
            bm.set(100, 1);
            expect(bm.has(100, 1)).toBe(true);
            expect(bm.entityCapacity).toBeGreaterThan(100);
        });

        it('preserves existing bits across growth', () => {
            const bm = new EntityBitmask(4);
            bm.set(0, 5);
            bm.set(3, 7);
            bm.growEntities(1000);
            expect(bm.has(0, 5)).toBe(true);
            expect(bm.has(3, 7)).toBe(true);
        });
    });

    describe('growChunks', () => {
        it('allows more component ids after growth', () => {
            const bm = new EntityBitmask(16, 1); // 32 components
            bm.set(0, 31);
            bm.set(0, 45); // triggers auto-grow to 2 chunks
            expect(bm.has(0, 31)).toBe(true);
            expect(bm.has(0, 45)).toBe(true);
            expect(bm.componentCapacity).toBeGreaterThanOrEqual(46);
        });

        it('preserves existing bits across chunk growth', () => {
            const bm = new EntityBitmask(4, 1);
            bm.set(0, 3);
            bm.set(1, 15);
            bm.set(3, 31);
            bm.growChunks(4);
            expect(bm.has(0, 3)).toBe(true);
            expect(bm.has(1, 15)).toBe(true);
            expect(bm.has(3, 31)).toBe(true);
        });
    });

    describe('matches', () => {
        const makeMask = (chunks: number, ...bits: number[]): Uint32Array => {
            const m = new Uint32Array(chunks);
            for (const bit of bits) {
                m[bit >>> 5]! |= 1 << (bit & 31);
            }
            return m;
        };

        it('passes when every include bit is present', () => {
            const bm = new EntityBitmask(16, 2);
            bm.set(0, 3);
            bm.set(0, 45);
            const include = makeMask(2, 3, 45);
            expect(bm.matches(0, include, null)).toBe(true);
        });

        it('fails when any include bit is missing', () => {
            const bm = new EntityBitmask(16, 2);
            bm.set(0, 3);
            // missing bit 45
            const include = makeMask(2, 3, 45);
            expect(bm.matches(0, include, null)).toBe(false);
        });

        it('fails when any exclude bit is present', () => {
            const bm = new EntityBitmask(16, 2);
            bm.set(0, 3);
            bm.set(0, 10);
            const include = makeMask(2, 3);
            const exclude = makeMask(2, 10);
            expect(bm.matches(0, include, exclude)).toBe(false);
        });

        it('passes when exclude is provided but no exclude bits are set', () => {
            const bm = new EntityBitmask(16, 2);
            bm.set(0, 3);
            const include = makeMask(2, 3);
            const exclude = makeMask(2, 10, 45);
            expect(bm.matches(0, include, exclude)).toBe(true);
        });
    });
});
