/**
 * The authentication control's settings, asked by how users sign in (product owner, 10
 * November 2026: "Should handle SSO, local login, password attributes... If local and both,
 * should require the user to input the critical password attributes including MFA"). Pure:
 * the requests the page sends and what comes back. Which settings are asked, which are
 * required, and the sentence they compose are the API's (authentication_profile): the page
 * never decides them.
 */

export type Setting = {
  key: string;
  label: string;
  question: string;
  options: string[];
  why: string;
  required: boolean;
  value: string;
};

export type Profile = {
  method: string;
  settings: Setting[];
  complete: boolean;
  composed: string;
  policies: Array<{ id: string; title: string }>;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KEY = /^[a-z][a-z0-9-]{1,40}$/;
const SECRET =
  /(?:api[_-]?key|secret|token|password|passwd|pwd)\s*[:=]\s*\S|sk-[A-Za-z0-9]{10,}/i;

export type AuthRequest =
  | { error: "invalid" }
  | {
      method: "GET" | "PUT" | "POST";
      path: string;
      body: Record<string, unknown> | null;
    };

/** The API call for a read, a save, or the policy's reading, checked before it is sent. */
export function authRequest(fields: Record<string, unknown>): AuthRequest {
  const text = (name: string) =>
    typeof fields[name] === "string" ? (fields[name] as string) : "";
  const org = text("organization_id");
  const project = text("project_id");
  const control = text("control_id");
  if (!UUID.test(org) || !UUID.test(project) || !UUID.test(control)) {
    return { error: "invalid" };
  }
  const path = `/organizations/${org}/projects/${project}/controls/${control}/authentication`;
  switch (fields.intent) {
    case "read":
      return { method: "GET", path, body: null };
    case "read-policy":
      return { method: "POST", path: `${path}/read-policy`, body: null };
    case "save": {
      const raw =
        typeof fields.values === "object" &&
        fields.values !== null &&
        !Array.isArray(fields.values)
          ? (fields.values as Record<string, unknown>)
          : {};
      const values: Record<string, string> = {};
      for (const [key, value] of Object.entries(raw)) {
        if (!KEY.test(key) || typeof value !== "string") {
          return { error: "invalid" };
        }
        const clean = value.trim();
        if (clean.length > 120 || SECRET.test(clean)) {
          return { error: "invalid" };
        }
        values[key] = clean;
      }
      const count = Object.keys(values).length;
      if (count === 0 || count > 13) {
        return { error: "invalid" };
      }
      return { method: "PUT", path, body: { values } };
    }
    default:
      return { error: "invalid" };
  }
}

/** The profile from the API's answer; null when it cannot be read. */
export function parseProfile(body: unknown): Profile | null {
  if (typeof body !== "object" || body === null) {
    return null;
  }
  const item = body as Record<string, unknown>;
  const text = (value: unknown) => (typeof value === "string" ? value : "");
  if (!Array.isArray(item.settings) || !Array.isArray(item.policies)) {
    return null;
  }
  const settings: Setting[] = [];
  for (const raw of item.settings as unknown[]) {
    if (typeof raw !== "object" || raw === null) {
      continue;
    }
    const each = raw as Record<string, unknown>;
    if (typeof each.key !== "string") {
      continue;
    }
    settings.push({
      key: each.key,
      label: text(each.label),
      question: text(each.question),
      options: Array.isArray(each.options)
        ? each.options.filter((o): o is string => typeof o === "string")
        : [],
      why: text(each.why),
      required: each.required !== false,
      value: text(each.value),
    });
  }
  const policies: Profile["policies"] = [];
  for (const raw of item.policies as unknown[]) {
    if (typeof raw === "object" && raw !== null) {
      const each = raw as Record<string, unknown>;
      if (typeof each.id === "string") {
        policies.push({ id: each.id, title: text(each.title) });
      }
    }
  }
  return {
    method: text(item.method),
    settings,
    complete: item.complete === true,
    composed: text(item.composed),
    policies,
  };
}

/** Where the settings' course goes next after `from`: the next required setting not
 * answered, else the next optional one not answered; the end (the length) when none is. */
export function nextSetting(profile: Profile, from: number): number {
  const open = (at: number) => {
    const each = profile.settings[at];
    return each !== undefined && each.value.trim() === "";
  };
  for (let at = from + 1; at < profile.settings.length; at += 1) {
    if (open(at) && profile.settings[at]?.required) {
      return at;
    }
  }
  for (let at = from + 1; at < profile.settings.length; at += 1) {
    if (open(at)) {
      return at;
    }
  }
  return profile.settings.length;
}

/** The required settings still unanswered: what holds the evidence. */
export function requiredLeft(profile: Profile): number {
  return profile.settings.filter((s) => s.required && s.value.trim() === "")
    .length;
}
