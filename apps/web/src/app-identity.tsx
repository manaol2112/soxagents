import { appKind } from "./app-kind";
import { UiIcon } from "./ui-icon";

/**
 * An application's identity, the same everywhere: a neutral system icon from its record
 * and its name. The icon is decorative; the name and the kind (in the title) say what it
 * is. Approved vendor logos, once the firm stores them, belong here and nowhere else.
 */
export function AppIdentity({
  name,
  layer,
  hosting,
  size = 16,
}: {
  name: string;
  layer: string | null;
  hosting: string | null;
  size?: number;
}) {
  const kind = appKind(layer, hosting);
  return (
    <span className="app-identity" title={`${name}: ${kind.label}`}>
      <span className="app-identity-mark" aria-hidden="true">
        <UiIcon name={kind.icon} size={size - 2} />
      </span>
      <span className="app-identity-name">{name}</span>
      <span className="sr-only">, {kind.label}</span>
    </span>
  );
}
