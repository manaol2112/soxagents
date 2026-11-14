"use client";

import {
  type FormEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  nextSetting,
  type Profile,
  parseProfile,
  requiredLeft,
} from "./authentication-model";
import { UiIcon } from "./ui-icon";
import {
  type NotesResult,
  notesChosen,
  runFailureLine as notesFailureLine,
  notesSummary,
  parseNotes,
} from "./understanding-chat-model";

type Ids = { organizationId: string; projectId: string; controlId: string };

const OTHER = "@other";

/**
 * The authentication control's settings, one at a time, within Control Understanding
 * (product owner, 10 November 2026). How users sign in comes first; the API then asks only
 * what applies: the identity provider and its MFA for single sign-on, and the core six for
 * local sign-in, required before the evidence is requested. A governing policy is read for
 * the settings, each with the words it rests on; without one, the settings are recorded as
 * the client states them.
 */
export function AuthenticationPoint({
  ids,
  canAct,
  onChanged,
  onDone,
  onBack,
}: {
  ids: Ids;
  canAct: boolean;
  /** After a save the server confirmed: the review and the page read again. */
  onChanged: () => Promise<void>;
  /** On to the review's next point. */
  onDone: () => void;
  /** Back to the review's point before this one. */
  onBack: () => void;
}) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [failed, setFailed] = useState(false);
  const [at, setAt] = useState(0);
  const [picked, setPicked] = useState<string | null>(null);
  const [typed, setTyped] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const [found, setFound] = useState<NotesResult | null>(null);
  const [chosen, setChosen] = useState<Record<string, boolean>>({});
  const started = useRef(false);

  const call = useCallback(
    async (
      method: "GET" | "PUT" | "POST",
      extra: Record<string, unknown> = {},
    ) => {
      const fields = {
        organization_id: ids.organizationId,
        project_id: ids.projectId,
        control_id: ids.controlId,
      };
      const response = await fetch(
        method === "GET"
          ? `/workspace/authentication?${new URLSearchParams(fields).toString()}`
          : "/workspace/authentication",
        method === "GET"
          ? undefined
          : {
              method,
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ ...fields, ...extra }),
            },
      );
      return (await response.json()) as {
        status?: unknown;
        detail?: unknown;
        body?: unknown;
      };
    },
    [ids],
  );

  const read = useCallback(async () => {
    try {
      const answer = await call("GET");
      const now = parseProfile(answer.body ?? null);
      setFailed(now === null);
      if (now !== null) {
        setProfile(now);
        // The first read opens on the first setting still to answer.
        if (!started.current) {
          started.current = true;
          setAt(nextSetting(now, -1));
        }
      }
    } catch {
      setFailed(true);
    }
  }, [call]);

  useEffect(() => {
    void read();
  }, [read]);

  async function save(values: Record<string, string>, message: string) {
    if (!canAct) {
      return false;
    }
    setSaving(true);
    setSaved(null);
    setProblem(null);
    let now: Profile | null = null;
    let detail = "";
    try {
      const answer = await call("PUT", { values });
      now = answer.status === 200 ? parseProfile(answer.body ?? null) : null;
      detail = typeof answer.detail === "string" ? answer.detail : "";
    } catch {
      now = null;
    }
    setSaving(false);
    if (now === null) {
      setProblem(
        detail !== ""
          ? `The setting could not be saved: ${detail}.`
          : "The setting could not be saved. Try again.",
      );
      return false;
    }
    setProfile(now);
    setSaved(message);
    setPicked(null);
    setTyped("");
    await onChanged();
    return now;
  }

  async function readPolicy() {
    setReading(true);
    setProblem(null);
    setSaved(null);
    let result: NotesResult | null = null;
    let detail = "";
    try {
      const answer = await call("POST");
      result = answer.status === 200 ? parseNotes(answer.body ?? null) : null;
      detail = typeof answer.detail === "string" ? answer.detail : "";
    } catch {
      result = null;
    }
    setReading(false);
    if (result === null) {
      setProblem(
        detail !== ""
          ? `The policy could not be read: ${detail}.`
          : "The policy could not be read. Try again.",
      );
      return;
    }
    setFound(result);
    setChosen(notesChosen(result.answers));
  }

  if (profile === null) {
    return failed ? (
      <p className="cc-problem" role="alert">
        The sign-in settings could not be loaded.{" "}
        <button type="button" className="cs-link" onClick={() => void read()}>
          Try again
        </button>
      </p>
    ) : (
      <p className="ur-loading" role="status">
        <span className="spinner small" aria-hidden="true" /> Reading the
        sign-in settings…
      </p>
    );
  }

  const left = requiredLeft(profile);
  const setting = at < profile.settings.length ? profile.settings[at] : null;
  const basis =
    profile.policies.length > 0 ? (
      <div className="au-basis">
        <p>
          <UiIcon name="file" size={14} />{" "}
          {profile.policies.map((p) => p.title).join(", ")}{" "}
          {profile.policies.length === 1 ? "governs" : "govern"} this system.
        </p>
        {found === null ? (
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            disabled={!canAct || reading || saving}
            onClick={() => void readPolicy()}
          >
            {reading ? (
              <span className="spinner small" aria-hidden="true" />
            ) : null}
            {reading
              ? "Reading the policy…"
              : "Read the settings from the policy"}
          </button>
        ) : null}
      </div>
    ) : (
      <p className="au-basis is-none">
        No password policy is on file for this system. The settings are recorded
        as stated by the organization, and the D&amp;I assessment weighs the
        missing policy.
      </p>
    );

  // What the policy says: chosen by the person, saved together.
  if (found !== null) {
    const count = found.answers.filter((a) => chosen[a.key] === true).length;
    return (
      <div className="ur-point">
        <div className="ur-kicker">
          <span className="ur-chip is-accent">Read from the policy</span>
        </div>
        <h3 className="ur-q" id="ur-q">
          The settings the policy states
        </h3>
        <p className="ur-hint">
          {notesFailureLine(found, "policy") ?? notesSummary(found, "policy")}
        </p>
        {found.answers.length > 0 ? (
          <ul className="ur-proposals">
            {found.answers.map((answer) => (
              <li key={answer.key}>
                <input
                  type="checkbox"
                  id={`au-${answer.key}`}
                  checked={chosen[answer.key] === true}
                  disabled={saving}
                  onChange={(event) => {
                    const on = event.target.checked;
                    setChosen((was) => ({ ...was, [answer.key]: on }));
                  }}
                />
                <label htmlFor={`au-${answer.key}`}>
                  <span className="ur-proposal-q">{answer.question}</span>
                  <strong>{answer.value}</strong>
                  {answer.current !== "" ? (
                    <small>Replaces: {answer.current}</small>
                  ) : null}
                </label>
                <blockquote>{answer.quote}</blockquote>
              </li>
            ))}
          </ul>
        ) : null}
        {problem !== null ? (
          <p className="cc-problem" role="alert">
            {problem}
          </p>
        ) : null}
        <div className="ur-foot">
          <p className="ur-foot-where" />
          <div className="ur-foot-actions">
            <button
              type="button"
              className="btn btn-secondary"
              disabled={saving}
              onClick={() => setFound(null)}
            >
              <UiIcon name="back" size={14} /> Back
            </button>
            {found.answers.length > 0 ? (
              <button
                type="button"
                className="btn btn-primary"
                disabled={!canAct || saving || count === 0}
                onClick={async () => {
                  const values = Object.fromEntries(
                    found.answers
                      .filter((a) => chosen[a.key] === true)
                      .map((a) => [a.key, a.value]),
                  );
                  const now = await save(
                    values,
                    `${count} ${count === 1 ? "setting" : "settings"} from the policy saved.`,
                  );
                  if (now !== false) {
                    setFound(null);
                    setAt(nextSetting(now, -1));
                  }
                }}
              >
                {saving ? (
                  <span className="spinner small" aria-hidden="true" />
                ) : null}
                {saving ? "Saving…" : `Use ${count} selected`}
                <UiIcon name="arrow" size={14} />
              </button>
            ) : null}
          </div>
        </div>
      </div>
    );
  }

  // Every setting asked has been through: what they compose, or what is still missing.
  if (setting === null || setting === undefined) {
    return (
      <div className="ur-end">
        {saved !== null ? (
          <p className="ur-saved" role="status">
            <UiIcon name="check" size={13} /> {saved}
          </p>
        ) : null}
        {profile.complete ? (
          <span className="ur-seal" aria-hidden="true">
            <UiIcon name="check" size={22} />
          </span>
        ) : null}
        <h3 className="ur-q">
          {profile.complete
            ? "The sign-in settings are recorded"
            : `${left} required ${left === 1 ? "setting is" : "settings are"} still missing`}
        </h3>
        {profile.complete ? (
          <p className="au-composed">{profile.composed}</p>
        ) : null}
        <dl className="ur-answers">
          {profile.settings.map((each, index) => (
            <div key={each.key}>
              <dt>
                {each.label[0]?.toUpperCase()}
                {each.label.slice(1)}
                {each.required ? "" : " (optional)"}
              </dt>
              <dd className="au-row">
                <span>{each.value || "Not answered"}</span>
                <button
                  type="button"
                  className="ur-skip"
                  disabled={!canAct}
                  onClick={() => {
                    setPicked(null);
                    setTyped("");
                    setAt(index);
                  }}
                >
                  {each.value ? "Change" : "Answer"}
                </button>
              </dd>
            </div>
          ))}
        </dl>
        <div className="ur-foot-actions">
          <button type="button" className="btn btn-secondary" onClick={onBack}>
            <UiIcon name="back" size={14} /> Back
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={!profile.complete}
            onClick={onDone}
          >
            Continue <UiIcon name="arrow" size={14} />
          </button>
        </div>
      </div>
    );
  }

  const held = setting.value;
  const choice =
    picked ??
    (held !== "" &&
    setting.options.length > 0 &&
    !setting.options.includes(held)
      ? OTHER
      : held);
  const other = choice === OTHER || setting.options.length === 0;
  const own =
    typed !== "" || picked === OTHER
      ? typed
      : !setting.options.includes(held)
        ? held
        : "";
  const answer = other ? own.trim() : choice;
  const unchanged = held !== "" && answer === held;
  const total = profile.settings.length;

  return (
    <form
      className="ur-point"
      autoComplete="off"
      onSubmit={async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        if (unchanged) {
          setAt(nextSetting(profile, at));
          return;
        }
        const now = await save(
          { [setting.key]: answer },
          `${setting.label[0]?.toUpperCase()}${setting.label.slice(1)}: saved.`,
        );
        if (now !== false) {
          setAt(nextSetting(now, at));
        }
      }}
    >
      {basis}
      {saved !== null ? (
        <p className="ur-saved" role="status">
          <UiIcon name="check" size={13} /> {saved}
        </p>
      ) : null}
      {problem !== null ? (
        <p className="cc-problem" role="alert">
          {problem}
        </p>
      ) : null}
      <div className="ur-kicker">
        <span className="ur-chip is-accent">Sign-in and passwords</span>
        {setting.required ? (
          <span className="ur-chip is-warm">Required</span>
        ) : (
          <span className="ur-chip">Optional</span>
        )}
        {held !== "" ? <span className="ur-chip is-ok">On record</span> : null}
      </div>
      <h3 className="ur-q" id="ur-q">
        {setting.question}
      </h3>
      {setting.options.length > 0 ? (
        <fieldset className="ur-options" aria-labelledby="ur-q">
          {/* How users sign in is one of three; every other setting may be the client's own. */}
          {[
            ...setting.options,
            ...(setting.key === "auth-signin" ? [] : [OTHER]),
          ].map((option) => {
            const on = choice === option;
            return (
              <label
                key={option}
                className={`ur-option${on ? " is-on" : ""}${option === OTHER ? " is-other" : ""}`}
              >
                <input
                  type="radio"
                  name={`au-${setting.key}`}
                  value={option}
                  checked={on}
                  disabled={!canAct || saving}
                  onChange={() => setPicked(option)}
                />
                <span className="ur-dot" aria-hidden="true" />
                <span className="ur-option-text">
                  {option === OTHER ? "Other (specify)" : option}
                </span>
                {option === held ? (
                  <span className="ur-tag">On record</span>
                ) : null}
              </label>
            );
          })}
        </fieldset>
      ) : null}
      {other && setting.key !== "auth-signin" ? (
        <input
          className="ur-other"
          type="text"
          maxLength={120}
          value={own}
          disabled={!canAct || saving}
          placeholder="Type the organization's setting"
          aria-label={`Answer to: ${setting.question}`}
          onChange={(event) => setTyped(event.target.value)}
        />
      ) : null}
      {setting.why !== "" ? (
        <details className="ur-why">
          <summary>Why this is asked</summary>
          <p>{setting.why}</p>
        </details>
      ) : null}
      <div className="ur-foot">
        <p className="ur-foot-where">
          {/* Until the method is known, the settings that follow it are not. */}
          {profile.method === ""
            ? "First: how users sign in"
            : `Setting ${at + 1} of ${total}${left > 0 ? ` · ${left} required left` : ""}`}
          {!setting.required || held !== "" ? (
            <button
              type="button"
              className="ur-skip"
              disabled={saving}
              onClick={() => setAt(nextSetting(profile, at))}
            >
              Skip for now
            </button>
          ) : null}
        </p>
        <div className="ur-foot-actions">
          <button
            type="button"
            className="btn btn-secondary"
            disabled={saving}
            onClick={() => (at === 0 ? onBack() : setAt(at - 1))}
          >
            <UiIcon name="back" size={14} /> Back
          </button>
          <button
            type="submit"
            className="btn btn-primary"
            disabled={!canAct || saving || answer === ""}
          >
            {saving ? (
              <span className="spinner small" aria-hidden="true" />
            ) : null}
            {saving ? "Saving…" : unchanged ? "Continue" : "Save & continue"}
            <UiIcon name="arrow" size={14} />
          </button>
        </div>
      </div>
    </form>
  );
}
