"use client";

import { type ReactNode, useId, useState } from "react";
import {
  type Attribute,
  type CriteriaState,
  criteriaState,
} from "./control-context-model";
import { useRelease } from "./phases-view";
import { UiIcon } from "./ui-icon";

type Ids = { organizationId: string; projectId: string; controlId: string };

const STATE_WORDS: Record<CriteriaState, string> = {
  OWNED: "Owned",
  TO_ACCEPT: "Tailored by the agent · to accept",
  MISSING: "Needs tailored criteria",
};

/**
 * An approved attribute's pass and fail criteria, tailored to the control (product owner,
 * 11 November 2026: "I want also these criteria to be displayed in the finalize the
 * attribute when a user reviews the attributes"). What the testers judge evidence against:
 * a person writes them, or accepts those the planner agent tailored from the standard's
 * requirement and the control's environment. Accepting and saving show only once the server
 * has recorded them; the page's data then refreshes in place.
 */
export function TailoredCriteria({
  ids,
  item,
  canAct,
  flat = false,
  extra = null,
  startEditing: writing = false,
}: {
  ids: Ids;
  item: Attribute;
  canAct: boolean;
  /** Inside an Attributes step row (product owner, 11 November 2026): the row's chip names
   * the state, so the criteria are a plain grid with the row's actions under it. */
  flat?: boolean;
  /** The row's other actions, after Accept and Edit (flat only). */
  extra?: ReactNode;
  /** Opens with the criteria form showing: the step's "Write criteria", after a run that
   * did not write them. */
  startEditing?: boolean;
}) {
  const action = useRelease(ids);
  const formId = useId();
  const criteria = item.criteria;
  const state = criteriaState(criteria);
  const [editing, setEditing] = useState(writing && canAct);
  // A person tailoring from nothing starts from the standard's requirement, where there is
  // one, and makes it this control's.
  const start = {
    condition: criteria.condition || (item.definition?.condition ?? ""),
    pass_criteria: criteria.passCriteria || (item.definition?.passes ?? ""),
    fail_criteria: criteria.failCriteria || (item.definition?.fails ?? ""),
  };
  const [form, setForm] = useState(start);
  const [judgment, setJudgment] = useState<boolean>(
    criteria.judgmentRequired === true,
  );
  const stated =
    criteria.condition !== "" ||
    criteria.passCriteria !== "" ||
    criteria.failCriteria !== "";
  const owner =
    state !== "OWNED"
      ? STATE_WORDS[state]
      : criteria.origin === "PERSON"
        ? "Written by the team"
        : `Accepted by ${criteria.acceptedBy || "a person"}`;
  const complete =
    judgment ||
    (form.condition.trim() !== "" &&
      form.pass_criteria.trim() !== "" &&
      form.fail_criteria.trim() !== "");
  const accept = () =>
    void action.run({
      intent: "criteria-accept",
      control_id: ids.controlId,
      attributes: [{ id: item.id, version: item.version }],
    });
  const startEditing = () => {
    setForm(start);
    setJudgment(criteria.judgmentRequired === true);
    setEditing(true);
  };
  const editor = editing ? (
    <CriteriaEditor
      id={formId}
      form={form}
      onForm={setForm}
      judgment={judgment}
      onJudgment={setJudgment}
      hint={item.definition !== null}
      busy={action.pending}
      complete={complete}
      onSave={async () => {
        const done = await action.run({
          intent: "criteria",
          control_id: ids.controlId,
          attribute_id: item.id,
          version: item.version,
          objective: criteria.objective,
          condition: form.condition,
          pass_criteria: form.pass_criteria,
          fail_criteria: form.fail_criteria,
          judgment_required: judgment,
          automatable: criteria.automatable,
          phases: criteria.phases,
        });
        if (done.ok) {
          setEditing(false);
        }
      }}
      onCancel={() => setEditing(false)}
    />
  ) : null;
  const problem =
    action.problem !== null ? (
      <p className="tc-problem" role="alert">
        {action.problem}
      </p>
    ) : null;
  if (flat) {
    return (
      <div className="tc is-flat" aria-busy={action.pending}>
        {stated || criteria.judgmentRequired === true ? (
          <dl className="tc-rules">
            {criteria.condition !== "" ? (
              <div>
                <dt>Tested</dt>
                <dd>{criteria.condition}</dd>
              </div>
            ) : null}
            <div className="is-pass">
              <dt>Passes</dt>
              <dd>{criteria.passCriteria || "Not stated"}</dd>
            </div>
            <div className="is-fail">
              <dt>Fails</dt>
              <dd>{criteria.failCriteria || "Not stated"}</dd>
            </div>
            {criteria.judgmentRequired === true ? (
              <div>
                <dt>Judgment</dt>
                <dd>Professional judgment required</dd>
              </div>
            ) : null}
          </dl>
        ) : (
          <p className="tc-missing">
            Not tailored to this control yet.{" "}
            {item.definition !== null
              ? "The planner tailors the standard's requirement when it plans the control, or write them from it."
              : "The planner states them when it plans the control, or write them."}
          </p>
        )}
        {state === "OWNED" ? <p className="tc-by">{owner}</p> : null}
        {editor}
        {!editing && (canAct || extra !== null) ? (
          <div className="tc-row-acts">
            {canAct && state === "TO_ACCEPT" ? (
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                disabled={action.pending}
                onClick={accept}
              >
                {action.pending ? "Accepting…" : "Accept"}
              </button>
            ) : null}
            {canAct ? (
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                aria-expanded={editing}
                aria-controls={formId}
                onClick={startEditing}
              >
                {stated ? "Edit" : "Write criteria"}
              </button>
            ) : null}
            {extra}
          </div>
        ) : null}
        {problem}
      </div>
    );
  }
  return (
    <div className={`tc is-${state.toLowerCase()}`} aria-busy={action.pending}>
      <div className="tc-head">
        <span className="tc-label">Pass / fail criteria</span>
        <span className={`tc-chip is-${state.toLowerCase()}`}>
          <UiIcon
            name={
              state === "OWNED"
                ? "check"
                : state === "TO_ACCEPT"
                  ? "sparkles"
                  : "info"
            }
            size={11}
          />
          {owner}
        </span>
        {canAct && !editing ? (
          <span className="tc-acts">
            {state === "TO_ACCEPT" ? (
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                disabled={action.pending}
                onClick={accept}
              >
                {action.pending ? "Accepting…" : "Accept"}
              </button>
            ) : null}
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              aria-expanded={editing}
              aria-controls={formId}
              onClick={startEditing}
            >
              {stated ? "Edit" : "Write criteria"}
            </button>
          </span>
        ) : null}
      </div>

      {stated || criteria.judgmentRequired === true ? (
        <dl className="tc-rules">
          {criteria.condition !== "" ? (
            <div>
              <dt>Tested</dt>
              <dd>{criteria.condition}</dd>
            </div>
          ) : null}
          <div className="is-pass">
            <dt>Passes when</dt>
            <dd>{criteria.passCriteria || "Not stated"}</dd>
          </div>
          <div className="is-fail">
            <dt>Fails when</dt>
            <dd>{criteria.failCriteria || "Not stated"}</dd>
          </div>
          {criteria.judgmentRequired === true ? (
            <div>
              <dt>Judgment</dt>
              <dd>Professional judgment required</dd>
            </div>
          ) : null}
        </dl>
      ) : (
        <p className="tc-missing">
          Not tailored to this control yet.{" "}
          {item.definition !== null
            ? "The planner tailors the standard's requirement when it plans the control, or write them from it."
            : "The planner states them when it plans the control, or write them."}
        </p>
      )}

      {editor}
      {problem}
    </div>
  );
}

/** One decision for every attribute whose tailored criteria wait for a person, each
 * accepted at the version shown and recorded on its own. */
export function AcceptAllCriteria({
  ids,
  items,
  compact = false,
}: {
  ids: Ids;
  items: readonly Attribute[];
  /** The button alone, in the Attributes step's title row (product owner, 11 November
   * 2026): the rows' chips already say which criteria wait. */
  compact?: boolean;
}) {
  const action = useRelease(ids);
  if (items.length < 2) {
    return null;
  }
  const run = () =>
    void action.run({
      intent: "criteria-accept",
      control_id: ids.controlId,
      attributes: items.map((item) => ({
        id: item.id,
        version: item.version,
      })),
    });
  if (compact) {
    return (
      <>
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          disabled={action.pending}
          title="Accepts the criteria the agent tailored, each recorded on its own."
          onClick={run}
        >
          {action.pending
            ? "Accepting…"
            : `Accept all ${items.length} criteria`}
        </button>
        {action.problem !== null ? (
          <p className="tc-problem ta-bar-problem" role="alert">
            {action.problem}
          </p>
        ) : null}
      </>
    );
  }
  return (
    <div className="tc-all">
      <p>
        <UiIcon name="sparkles" size={13} />
        The agent tailored the criteria of {items.length} attributes to this
        control. Review them below, then accept them together.
      </p>
      <button
        type="button"
        className="btn btn-secondary btn-sm"
        disabled={action.pending}
        onClick={run}
      >
        {action.pending ? "Accepting…" : `Accept all ${items.length} criteria`}
      </button>
      {action.problem !== null ? (
        <p className="tc-problem" role="alert">
          {action.problem}
        </p>
      ) : null}
    </div>
  );
}

type CriteriaForm = {
  condition: string;
  pass_criteria: string;
  fail_criteria: string;
};

/** The form that writes an attribute's criteria for this control. */
function CriteriaEditor({
  id,
  form,
  onForm,
  judgment,
  onJudgment,
  hint,
  busy,
  complete,
  onSave,
  onCancel,
}: {
  id: string;
  form: CriteriaForm;
  onForm: (form: CriteriaForm) => void;
  judgment: boolean;
  onJudgment: (judgment: boolean) => void;
  /** The attribute has a standard's requirement to keep. */
  hint: boolean;
  busy: boolean;
  complete: boolean;
  onSave: () => Promise<void>;
  onCancel: () => void;
}) {
  return (
    <div className="tc-edit" id={id}>
      {(
        [
          ["condition", "The condition tested, at this organization"],
          ["pass_criteria", "Passes when"],
          ["fail_criteria", "Fails when"],
        ] as const
      ).map(([name, label]) => (
        <label key={name}>
          {label}
          <textarea
            rows={2}
            maxLength={1000}
            value={form[name]}
            onChange={(event) =>
              onForm({ ...form, [name]: event.target.value })
            }
          />
        </label>
      ))}
      <label className="tc-judgment">
        <input
          type="checkbox"
          checked={judgment}
          onChange={(event) => onJudgment(event.target.checked)}
        />
        Needs professional judgment (not objectively testable)
      </label>
      {hint ? (
        <p className="tc-hint">
          Name this organization's system, tool, roles and policy, and keep
          every part of the standard's requirement.
        </p>
      ) : null}
      <div className="tc-edit-acts">
        <button
          type="button"
          className="btn btn-primary btn-sm"
          disabled={busy || !complete}
          onClick={() => void onSave()}
        >
          {busy ? "Saving…" : "Save criteria"}
        </button>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={onCancel}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
