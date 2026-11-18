import { useId } from "react";

import {
  DOMAINS,
  FREQUENCIES,
  NATURES,
  type Onboarding,
  type SetupControl,
  type SetupProcess,
} from "./onboarding-model";
import { SetupForm } from "./setup-form";
import type { ShellModel } from "./shell-model";
import { UiIcon } from "./ui-icon";

type Ready = Extract<ShellModel, { status: "ready" }>;

/**
 * A control the team writes itself: a business process control for a cycle, a key
 * report for a system, or a control for one system. The area is fixed by where the
 * form sits; a system-bound control names its system. It is saved in the background
 * and, after launch, gets its work at once.
 */
export function NewControlForm({
  model,
  onboarding,
  domains,
  systems,
  processes = [],
  processId = null,
  title,
  example,
}: {
  model: Ready;
  onboarding: Onboarding;
  /** The areas offered; one area fixes it. */
  domains: readonly string[];
  /** The systems a system-bound control may belong to; empty for a process control. */
  systems: ReadonlyArray<{ id: string; name: string }>;
  /** Processes the team named, offered next to the areas when the form is not inside one. */
  processes?: readonly SetupProcess[];
  /** The named process the form sits in: fixes the control's process and area. */
  processId?: string | null;
  title: string;
  example: Pick<SetupControl, "controlRef" | "title">;
}) {
  const id = useId();
  const labels = new Map(DOMAINS);
  const picks =
    processId === null && (processes.length > 0 || domains.length > 1);
  return (
    <details className="sys-more new-control">
      <summary>
        <span>
          <UiIcon name="plus" size={13} /> {title}
        </span>
      </summary>
      <SetupForm className="new-control-form">
        <input
          type="hidden"
          name="organization_id"
          value={model.organization.id}
        />
        <input type="hidden" name="project_id" value={onboarding.projectId} />
        <input type="hidden" name="intent" value="control-new" />
        <input type="hidden" name="step" value="controls" />
        {processId !== null ? (
          <input type="hidden" name="process_id" value={processId} />
        ) : !picks && domains.length === 1 ? (
          <input type="hidden" name="domain" value={domains[0]} />
        ) : null}
        <div className="new-control-grid">
          <label htmlFor={`${id}-ref`}>
            Control ID
            <input
              id={`${id}-ref`}
              name="control_ref"
              required
              maxLength={40}
              placeholder={example.controlRef}
            />
          </label>
          <label className="span-2" htmlFor={`${id}-title`}>
            Title
            <input
              id={`${id}-title`}
              name="title"
              required
              maxLength={200}
              placeholder={example.title}
            />
          </label>
          {picks ? (
            <label htmlFor={`${id}-process`}>
              Process
              <select
                id={`${id}-process`}
                name="process"
                defaultValue={
                  processes[0] !== undefined
                    ? `process:${processes[0].id}`
                    : `domain:${domains[0]}`
                }
              >
                {processes.length > 0 ? (
                  <optgroup label="Processes you named">
                    {processes.map((process) => (
                      <option key={process.id} value={`process:${process.id}`}>
                        {process.name}
                      </option>
                    ))}
                  </optgroup>
                ) : null}
                <optgroup label="Standard cycles">
                  {domains.map((domain) => (
                    <option key={domain} value={`domain:${domain}`}>
                      {labels.get(domain) ?? domain}
                    </option>
                  ))}
                </optgroup>
              </select>
            </label>
          ) : null}
          {systems.length > 0 ? (
            <label htmlFor={`${id}-system`}>
              System
              <select
                id={`${id}-system`}
                name="application_id"
                defaultValue={systems[0]?.id ?? ""}
              >
                {systems.map((system) => (
                  <option key={system.id} value={system.id}>
                    {system.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <label htmlFor={`${id}-frequency`}>
            Frequency
            <select
              id={`${id}-frequency`}
              name="frequency"
              defaultValue="MONTHLY"
            >
              {FREQUENCIES.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label htmlFor={`${id}-nature`}>
            Nature
            <select id={`${id}-nature`} name="nature" defaultValue="MANUAL">
              {NATURES.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="check" htmlFor={`${id}-key`}>
            <input
              id={`${id}-key`}
              type="checkbox"
              name="key_control"
              defaultChecked
            />
            Key control
          </label>
          <label className="span-3" htmlFor={`${id}-risk`}>
            Risk it addresses
            <input
              id={`${id}-risk`}
              name="risk"
              maxLength={1000}
              placeholder="What could go wrong without it"
            />
          </label>
          <label className="span-3" htmlFor={`${id}-activity`}>
            Control activity
            <textarea
              id={`${id}-activity`}
              name="activity"
              rows={3}
              required
              maxLength={4000}
              placeholder="What is done, by whom, how often, and what happens when an exception is found"
            />
          </label>
          <label className="span-3" htmlFor={`${id}-attributes`}>
            Test attributes, one per line
            <textarea
              id={`${id}-attributes`}
              name="test_attributes"
              rows={3}
              required
              placeholder={
                "Reviewer is independent of the preparer\nEvidence of review is dated within the period"
              }
            />
          </label>
          <label className="span-3" htmlFor={`${id}-pbc`}>
            Evidence to request, one per line
            <textarea
              id={`${id}-pbc`}
              name="pbc_items"
              rows={2}
              placeholder={
                "Population of items for the period\nEvidence of review for the selected items"
              }
            />
          </label>
        </div>
        <div className="form-actions">
          <button type="submit" className="btn-sm">
            <UiIcon name="plus" size={13} /> Add to scope
          </button>
          <span className="form-hint">
            Added as in scope with the standard workpaper template for its kind.
            {onboarding.started
              ? " The engagement is running, so it gets its tasks and a draft evidence request at once."
              : ""}
          </span>
        </div>
      </SetupForm>
    </details>
  );
}
