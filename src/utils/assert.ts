/**
 * Dev-mode assertions. In production builds (esbuild with `--define:__DEV__=false`)
 * these calls are tree-shaken away entirely. In dev they throw loud descriptive errors.
 */

declare const __DEV__: boolean;

/** Compile-time feature flag. Defaults to `true` when not defined by the bundler. */
const DEV: boolean = typeof __DEV__ === 'undefined' ? true : __DEV__;

/** Throw in dev if `cond` is falsy. No-op in prod. */
export function assert(cond: unknown, message: string): asserts cond {
    if (DEV && !cond) {
        throw new Error(`[nvx-ecs] assertion failed: ${message}`);
    }
}

/** Throw in dev. No-op in prod. */
export function invariant(message: string): never {
    throw new Error(`[nvx-ecs] invariant violated: ${message}`);
}
