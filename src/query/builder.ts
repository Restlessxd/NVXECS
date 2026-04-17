/**
 * Fluent query builder.
 *
 * ```ts
 * const moving = world.query()
 *     .with(Position, Velocity)
 *     .without(Frozen)
 *     .build();
 * ```
 *
 * `build()` validates that every listed component is registered with the
 * world and resolves component ids once, so subsequent iterations don't
 * revisit the component registry.
 *
 * Queries should be built once at system construction and reused on every
 * tick — the returned {@link Query} keeps its masks cached across calls.
 */

import { Query } from './query.js';
import type { ComponentRegistry } from '../schema/registry.js';
import type { ComponentDef } from '../schema/types.js';

export class QueryBuilder {
    private readonly _registry: ComponentRegistry;
    private readonly _include: ComponentDef[] = [];
    private readonly _exclude: ComponentDef[] = [];

    /** @internal constructed by {@link World.query}. */
    constructor(registry: ComponentRegistry) {
        this._registry = registry;
    }

    /** Require the entity to have every listed component. */
    with(...defs: ComponentDef[]): this {
        for (const def of defs) this._include.push(def);
        return this;
    }

    /** Require the entity to have none of the listed components. */
    without(...defs: ComponentDef[]): this {
        for (const def of defs) this._exclude.push(def);
        return this;
    }

    /** Finalize and return a {@link Query}. All components must be registered. */
    build(): Query {
        return new Query(this._registry, this._include.slice(), this._exclude.slice());
    }
}
