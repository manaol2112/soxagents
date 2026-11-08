import type { IconName } from "./ui-icon";

/** A system's icon by its layer, as the system picker shows it when the system is
 * chosen; one map for every screen that names a system. */
export const LAYER_ICON: Record<string, IconName> = {
  APPLICATION: "window",
  DATABASE: "database",
  OPERATING_SYSTEM: "server",
  INFRASTRUCTURE: "cloud",
  TOOL: "wrench",
};

/** The icon for a system of this layer; an application's when the layer is unknown. */
export function layerIcon(layer: string | null | undefined): IconName {
  return LAYER_ICON[layer ?? ""] ?? "window";
}
