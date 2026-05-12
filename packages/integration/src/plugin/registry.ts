import type { LanePluginPack } from "../lane/lane-plugins";
import type { CanonicalSpec } from "@seqlok/schema";
import { createIntegrationError } from "../errors/integration";

export interface LanePluginDefinition<S extends CanonicalSpec> {
  readonly id: string;
  readonly create: () => LanePluginPack<S>;
}

/**
 * Identity helper for lane plugins.
 *
 * Lets call sites be more explicit and centralizes the type parameters.
 */
export function definePlugin<S extends CanonicalSpec>(
  definition: LanePluginDefinition<S>,
): LanePluginDefinition<S> {
  return definition;
}

export interface PluginRegistry<S extends CanonicalSpec> {
  register(plugin: LanePluginDefinition<S>): void;
  get(id: string): LanePluginDefinition<S> | undefined;
  list(): readonly LanePluginDefinition<S>[];
}

/**
 * Simple in-memory plugin registry.
 *
 * Intended to live at host level (Dekzer / lanes), not inside workers.
 */
export function createPluginRegistry<
  S extends CanonicalSpec,
>(): PluginRegistry<S> {
  const byId = new Map<string, LanePluginDefinition<S>>();

  const register = (plugin: LanePluginDefinition<S>): void => {
    if (byId.has(plugin.id)) {
      throw createIntegrationError("duplicatePlugin", {
        pluginId: plugin.id,
      });
    }
    byId.set(plugin.id, plugin);
  };

  const get = (id: string): LanePluginDefinition<S> | undefined => {
    return byId.get(id);
  };

  const list = (): readonly LanePluginDefinition<S>[] => {
    return Array.from(byId.values());
  };

  return { register, get, list };
}
