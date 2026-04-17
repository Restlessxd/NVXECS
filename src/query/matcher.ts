/**
 * Pure helpers that turn component id lists into chunked `Uint32Array`
 * bitmasks for use with {@link EntityBitmask.matches}.
 *
 * These live in their own module so the mask-building logic is unit-testable
 * without any world or registry setup.
 */

const BITS_PER_CHUNK = 32;

/**
 * Build a chunked include/exclude bitmask from a list of component ids.
 *
 * Each bit position corresponds to a component id. The resulting mask has
 * `chunksPerEntity` `Uint32` chunks so it can be ANDed against any entity row
 * in the {@link EntityBitmask}.
 *
 * Ids greater than or equal to `chunksPerEntity * 32` are ignored — callers
 * should rebuild their masks when the bitmask grows its chunks-per-entity.
 */
export function buildComponentMask(
    componentIds: readonly number[],
    chunksPerEntity: number,
): Uint32Array {
    const mask = new Uint32Array(chunksPerEntity);
    const maxId = chunksPerEntity * BITS_PER_CHUNK;
    for (let i = 0; i < componentIds.length; i++) {
        const id = componentIds[i]!;
        if (id >= maxId) continue;
        mask[id >>> 5]! |= 1 << (id & 31);
    }
    return mask;
}
