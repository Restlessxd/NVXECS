/**
 * nvx-ecs public API.
 *
 * Only symbols re-exported here are considered stable and part of the public contract.
 * Imports from deeper paths (e.g. `nvx-ecs/src/internal/*`) are not supported.
 */

// --- Core ------------------------------------------------------------------
export { World, type WorldOptions } from './core/world.js';
export { EntityStore } from './core/entity.js';

// --- Storage ---------------------------------------------------------------
export { SparseSet, type DenseGrowHook } from './storage/sparse-set.js';
export { EntityBitmask } from './storage/bitmask.js';
export { SideTable } from './storage/side-table.js';
export { ComponentStore, type RefFieldArrays } from './storage/component-store.js';
export type {
    FieldKind,
    FieldSpec,
    ComponentStoreOptions,
    RemoveResult,
} from './storage/types.js';

// --- Schema ---------------------------------------------------------------
export { defineComponent, type DefineComponentInput } from './schema/define.js';
export { ComponentRegistry, type ComponentInfo } from './schema/registry.js';
export type {
    ComponentDef,
    ComponentView,
    ComponentInit,
    ComponentStorageMode,
    FieldMap,
    NumericFieldKind,
    NumericArrayFor,
    ViewField,
    InitValue,
} from './schema/types.js';

// --- Query ----------------------------------------------------------------
export { Query, type QueryForEachCallback, type QuerySnapshot } from './query/query.js';
export { QueryBuilder } from './query/builder.js';
export { buildComponentMask } from './query/matcher.js';

// --- System ---------------------------------------------------------------
export { System } from './system/system.js';
export { Scheduler, topoSort, type SchedulerOptions } from './system/scheduler.js';
export {
    type SystemContext,
    type SystemStage,
    DEFAULT_STAGE,
} from './system/types.js';

// --- Events ---------------------------------------------------------------
export { defineEvent, type DefineEventInput } from './events/define.js';
export { EventBus } from './events/bus.js';
export { EventChannel } from './events/channel.js';
export type { EventDef, EventView, EventInit, EventViewField } from './events/types.js';

// --- Utilities -------------------------------------------------------------
export { growTypedArray, type TypedNumericArray } from './utils/typed-array.js';

// --- Types -----------------------------------------------------------------
export {
    type EntityRef,
    type Generation,
    type EntityHandle,
    INVALID_REF,
    INVALID_GEN,
} from './types/index.js';
