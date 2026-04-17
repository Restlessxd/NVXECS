/**
 * Shared helpers for typed-array manipulation.
 *
 * These are hot-path friendly — they do one thing, allocate only when the caller
 * asks them to, and stay monomorphic so V8 can inline them.
 */

/** All numeric typed arrays that may be used as component field storage. */
export type TypedNumericArray =
    | Float32Array
    | Float64Array
    | Int8Array
    | Uint8Array
    | Int16Array
    | Uint16Array
    | Int32Array
    | Uint32Array;

/** Constructor signature shared by every typed numeric array. */
type TypedArrayCtor<T extends TypedNumericArray> = new (length: number) => T;

/**
 * Reallocate a typed array to `newCapacity` and copy the existing contents in.
 * Returns a **new** array — callers must replace any cached reference they hold.
 *
 * The returned array has the same element type as the input; extra slots are
 * zero-initialized by the typed-array constructor.
 */
export function growTypedArray<T extends TypedNumericArray>(arr: T, newCapacity: number): T {
    const Ctor = arr.constructor as TypedArrayCtor<T>;
    const grown = new Ctor(newCapacity);
    grown.set(arr);
    return grown;
}
