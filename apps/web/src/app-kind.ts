/** An application's kind, from its system record, for its neutral icon. */

/** The neutral icons a system can have (each one of ui-icon's). */
export type KindIcon =
  | "window"
  | "cloud"
  | "database"
  | "server"
  | "layers"
  | "wrench";

/** What the system record says an application is, in words, and its neutral icon. */
const LAYERS: Record<string, { label: string; icon: KindIcon }> = {
  APPLICATION: { label: "Application", icon: "window" },
  DATABASE: { label: "Database", icon: "database" },
  OPERATING_SYSTEM: { label: "Operating system", icon: "server" },
  INFRASTRUCTURE: { label: "Infrastructure", icon: "layers" },
  TOOL: { label: "Tool", icon: "wrench" },
};

const HOSTING: Record<string, string> = {
  SAAS: "SaaS",
  VENDOR_HOSTED: "Vendor-hosted",
  ON_PREMISES: "On premises",
};

/** The icon and the words for an application, from its recorded layer and hosting: a
 * cloud for a SaaS application, otherwise the layer's icon. Never a vendor's logo drawn
 * from memory and never a letter; an unknown system gets the plain application icon. */
export function appKind(
  layer: string | null,
  hosting: string | null,
): { icon: KindIcon; label: string } {
  const known = LAYERS[layer ?? ""] ?? LAYERS.APPLICATION;
  const where = HOSTING[hosting ?? ""];
  return {
    icon:
      (layer ?? "APPLICATION") === "APPLICATION" && hosting === "SAAS"
        ? "cloud"
        : (known?.icon ?? "window"),
    label: [where, (known?.label ?? "Application").toLowerCase()]
      .filter(Boolean)
      .join(" "),
  };
}
