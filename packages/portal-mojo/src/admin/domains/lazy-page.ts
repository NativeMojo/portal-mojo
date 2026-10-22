import type { ComponentType } from 'react';

/** Adapt an explicit named page export; every route keeps its literal lazy import. */
export function namedPage<TName extends string>(name: TName) {
    return <TModule extends Record<TName, ComponentType>>(module: TModule) => ({ default: module[name] });
}
