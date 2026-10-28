import Link from "next/link";
import type { ReactNode } from "react";
import { AutoRefresh } from "./auto-refresh";
import type { Design } from "./control-context-model";
import { DesignPanel } from "./control-context-view";
import { FilePicker } from "./file-picker";
import { formatDate } from "./format";
import { areaSelected } from "./new-engagement-model";
import {
  CONTROL_CATEGORIES,
  type ControlCategory,
  categoryOf,
  counted,
  DOMAIN_GROUPS,
  DOMAINS,
  domainTester,
  FREQUENCIES,
  families,
  kindForDomain,
  LAYERS,
  NATURES,
  type Onboarding,
  type PreviewSection,
  pickCategory,
  previewChoices,
  type RcmImport,
  type RcmSystems,
  type SetupControl,
  type SetupNotice,
  type SetupState,
  type SetupStep,
  type SetupTemplate,
  SOC_STATUS_LABELS,
  scopeCounts,
  setupProblem,
  socOverview,
  TEMPLATE_KINDS,
  TESTERS,
  uniqueKeys,
  VALUE_FIELDS,
  VALUE_OPTIONS,
  type ValueField,
  type WorkpaperPreview,
} from "./onboarding-model";
import { ProcessesCard, ReportsCard } from "./process-view";
import { RecordDialog } from "./record-dialog";
import { canonicalQuery, placeSetup } from "./routes";
import { SetupForm } from "./setup-form";
import type { ShellModel } from "./shell-model";
import { SystemsScoping } from "./systems-view";
import { TemplateEditor } from "./template-editor";
import { TemplatePreviewDialog } from "./template-preview-dialog";
import { UiIcon } from "./ui-icon";
import { Banner, CardHeader, EmptyState } from "./workspace-view";

type Ready = Extract<ShellModel, { status: "ready" }>;

export const NOTICES: Record<SetupNotice, string> = {
  "setup-created":
    "The engagement is created. Setup continues with what the planner has drafted.",
  "setup-saved": "Saved.",
  "setup-drafting":
    "The planner is preparing suggestions. They appear here in a moment.",
  "setup-accepted": "Suggestions applied.",
  "setup-invalid": "Check the fields and try again.",
  "setup-changed":
    "Something changed since the page loaded. Review it and try again.",
  "setup-started":
    "The engagement has started, so its setup is locked. Team changes are still allowed.",
  "setup-incomplete": "Finish every setup step before starting the engagement.",
  "setup-denied": "Your role cannot change this engagement's setup.",
  "setup-unavailable": "That could not be saved. Try again.",
  "setup-period-order":
    "The planner's period end falls on or before the period start, so it was not applied. Set the dates in the engagement profile.",
  "setup-launched":
    "Engagement started. The agents have their tasks, and evidence requests are drafted for approval.",
  "setup-rcm-uploaded":
    "RCM uploaded. Check the suggested column matches and the client's terms, then import.",
  "setup-rcm-unreadable":
    "That file could not be read as an RCM. Upload an .xlsx workbook or a .csv file with a header row.",
  "setup-rcm-large":
    "That file is larger than 5 MB. Remove unused sheets and upload it again.",
  "setup-rcm-incomplete":
    "The mapping is not complete yet. Resolve the listed items, save, and import again.",
  "invite-sent":
    "Added to the team. With email sending on, their welcome email is sent now; otherwise it is ready and waits.",
  "welcomes-sent":
    "Welcome emails sent. Any addressed outside the allowed email domains still wait.",
  "live-email-off": "Email sending is off, so the welcome emails still wait.",
  "invite-email": "That is not a valid email address.",
  "invite-domain":
    "Invitations go only to your firm's email domains. Ask an owner or admin to add the domain first.",
  "invite-disposable":
    "That address uses a temporary email service, so it cannot be invited.",
  "invite-no-mail":
    "That email domain does not receive mail. Check the address.",
  "invite-unchecked":
    "We could not check that email domain just now. Try again in a moment.",
  "invite-no-domains":
    "Add your firm's email domain below before inviting people.",
  "invite-limit":
    "You have sent the most invitations allowed in an hour. Try again later.",
  "invite-disabled":
    "That person's access to the firm is switched off. Ask an owner or admin.",
  "domain-saved": "Firm email domains updated.",
  "domain-invalid": "Enter a domain such as yourfirm.com.",
  "setup-needs-system":
    "Add at least one in-scope system before loading the standard library.",
  "setup-template-uploaded":
    "Template uploaded. Preview it with one of your controls, then use it for that kind of control.",
  "setup-template-unreadable":
    "That file could not be read as a template. Upload a Word document (.docx) or an Excel workbook (.xlsx) under 5 MB. Name its sheets or top headings Design, Interim, and Roll-forward, or say which part of the workpaper it is.",
  "setup-template-customized":
    "Your copy is ready. Edit its tabs and sections, then save it as your firm's template.",
  "setup-control-exists":
    "A control with that ID is already in this engagement. Choose another ID.",
  "setup-control-in-scope":
    "That control is already in scope for this system under another ID.",
  "setup-launch-slow":
    "The launch took longer than expected to answer. This page shows where it stands: if it says the engagement is running, it launched. It cannot launch twice.",
  "setup-slow":
    "That took longer than expected to answer and may have been saved. This page shows the latest.",
  "setup-already-launched":
    "This engagement has already launched. It launches once, so nothing was started twice.",
  "setup-archived":
    "This engagement is archived. It is closed, so its setup cannot change.",
  "setup-completed":
    "This engagement is completed and read-only. An owner or admin can reopen it under Engagements.",
  "setup-system-exists":
    "That system is already in scope. Open it from the list instead of adding it again.",
  "setup-control-tested":
    "This control has testing on record, so the change was not saved. Changing its frequency, nature, or area can make its sample and results stale. Tick the confirmation on the control and save again to go ahead.",
  "setup-process-exists":
    "A process with that name is already in this engagement. Open it below, or choose another name.",
  "setup-process-in-use":
    "That process has controls, so it stays. Take its controls out of scope instead; their work and records are kept.",
  "setup-template-saved":
    "Template saved. Controls that use it follow the new shape.",
  "system-needs-facts":
    "Confirm how the system is run before deciding its recommended controls.",
  "domain-no-mail":
    "That domain does not receive email, so it cannot be a firm domain.",
  "domain-disposable":
    "That is a temporary email service, so it cannot be a firm domain.",
  "domain-public":
    "Public email services such as Gmail cannot be a firm domain.",
  "setup-rcm-imported":
    "RCM imported. Tailor the controls, then confirm the workpaper templates again.",
  "setup-needs-reason":
    "This change affects recorded work and requires a reason. Provide the reason in the confirmation; it is recorded in the audit trail.",
  "setup-last-reviewer":
    "This person is the engagement's only independent reviewer. Assign another reviewer before removing them.",
  "setup-period-changed":
    "The profile was updated since the page loaded. Review the period again before confirming it.",
  "setup-period-confirmed":
    "Period confirmed as recorded. The confirmation is recorded in the audit trail; any later change to the name, scope, or dates requires confirmation again.",
};

export const ROLE_LABELS: Record<string, string> = {
  LEAD: "Engagement lead",
  PREPARER: "Preparer",
  REVIEWER: "Independent reviewer",
};

const FREQUENCY_LABEL = Object.fromEntries(FREQUENCIES);
const NATURE_LABEL = Object.fromEntries(NATURES);
const AREA_LABEL: Record<string, string> = Object.fromEntries(DOMAINS);

export function setupHref(
  model: Ready,
  step: SetupStep,
  extra: Record<string, string> = {},
): string {
  // In Controls, the systems, controls, and templates set up there keep their links
  // there; everything else is setup's.
  const inControls =
    model.section === "controls" &&
    (step === "controls" || step === "workpapers");
  const params = new URLSearchParams({
    organization: model.organization.id,
    section: inControls ? "controls" : "setup",
    step,
  });
  canonicalQuery(params);
  placeSetup(params, model.selectedProject?.status ?? null);
  if (model.selectedProject !== null) {
    params.set("project", model.selectedProject.id);
  }
  for (const [key, value] of Object.entries(extra)) {
    params.set(key, value);
  }
  return `/?${params.toString()}`;
}

export function Identity({
  model,
  onboarding,
  intent,
  step,
}: {
  model: Ready;
  onboarding: Onboarding;
  intent: string;
  step: SetupStep;
}) {
  return (
    <>
      <input
        type="hidden"
        name="organization_id"
        value={model.organization.id}
      />
      <input type="hidden" name="project_id" value={onboarding.projectId} />
      <input type="hidden" name="intent" value={intent} />
      <input type="hidden" name="step" value={step} />
    </>
  );
}

// Step 3

export function RcmStep({
  model,
  onboarding,
  editable,
  selected,
  category,
  rcmImport,
  system = null,
  design = null,
  notice = null,
}: {
  model: Ready;
  onboarding: Onboarding;
  editable: boolean;
  selected: string | null;
  category: string | null;
  rcmImport: RcmImport | null;
  /** The system open in the systems panel. */
  system?: string | null;
  /** The open control's statement and client values (8.9). */
  design?: Design | null;
  /** The last action's outcome, shown in the open control when it went wrong. */
  notice?: SetupNotice | null;
}) {
  if (rcmImport !== null && editable) {
    return (
      <RcmImportView model={model} onboarding={onboarding} upload={rcmImport} />
    );
  }
  // One row per control ID: its instances, one per application, edited together.
  const controls = families(onboarding.controls);
  if (controls.length === 0) {
    return (
      <>
        <SystemsCard
          model={model}
          onboarding={onboarding}
          editable={editable}
          selected={system}
        />
        <ControlOptions
          model={model}
          onboarding={onboarding}
          editable={editable}
        />
      </>
    );
  }
  const active = pickCategory(category, controls, selected);
  const tab = CONTROL_CATEGORIES.find((item) => item.id === active);
  const shown = controls.filter(
    (control) => categoryOf(control.domain) === active,
  );
  // The counts are per system: each system's copy of a control is tested on its own, so
  // removing a system takes its controls out of the counts.
  const counts = scopeCounts(onboarding.controls, active);
  // The link may name any instance of the control; the editor opens its family. It is
  // found in every tab, so opening a control over the page never changes the page: a key
  // report opened from a system on the IT tab opens over the IT tab.
  const picked = onboarding.controls.find((control) => control.id === selected);
  const editing =
    picked === undefined
      ? null
      : (controls.find((control) => control.controlRef === picked.controlRef) ??
        null);
  const uploaded = onboarding.rcmSource === "UPLOAD";
  return (
    <>
      <RcmSource model={model} onboarding={onboarding} editable={editable} />
      <RcmTabs
        model={model}
        controls={onboarding.controls.filter(counted)}
        active={active}
      />
      {shown.length === 0 && active !== "it" ? null : shown.length === 0 ? (
        <section className="card">
          <EmptyState
            icon={active === "reports" ? "table" : "shield"}
            title={`No ${tab === undefined ? "controls" : lowerLabel(tab.label)} yet`}
            detail={
              uploaded
                ? `None of the uploaded controls is in ${tab?.detail.toLowerCase() ?? "this group"}. Upload a new version, or move a control here by changing its area.`
                : `Add ${tab?.detail.toLowerCase() ?? "these areas"} from the library above, or upload the client's RCM.`
            }
          />
        </section>
      ) : (
        <section className="kpis" aria-label={`${tab?.label ?? "RCM"} summary`}>
          <article className="kpi">
            <p className="kpi-label">In scope</p>
            <strong className="kpi-value">{counts.inScope}</strong>
            <span className="kpi-detail">
              {counts.total === 0 && active !== "business"
                ? "No system in scope yet"
                : `of ${counts.total} ${active === "reports" ? "reports" : "controls"}${
                    counts.ids !== counts.total
                      ? ` (${counts.ids} control IDs across systems)`
                      : ""
                  }`}
            </span>
          </article>
          <article className="kpi">
            <p className="kpi-label">Key controls</p>
            <strong className="kpi-value">{counts.key}</strong>
            <span className="kpi-detail">Relied on for the opinion</span>
          </article>
        </section>
      )}
      {editing !== null ? (
        <RecordDialog
          eyebrow={controlEyebrow(editing, onboarding)}
          title={`${editing.controlRef} ${editing.title}`}
          description={editing.activity}
          closeHref={setupHref(model, "controls", {
            category: active,
            ...(system !== null ? { system } : {}),
          })}
        >
          {notice !== null && setupProblem(notice) !== null ? (
            <Banner tone="warning">{NOTICES[notice]}</Banner>
          ) : null}
          <ControlEditor
            model={model}
            onboarding={onboarding}
            control={editing}
            editable={editable}
            framed={false}
            returnTo={{ category: active, system }}
          />
          {design !== null && selected !== null ? (
            <section className="card" aria-label="Control statement">
              <CardHeader
                title="Control statement and client values"
                titleId="control-statement-title"
                description="How the library states this control, with the values only the client knows. Testing waits for the ones marked."
              />
              <div className="card-body">
                <DesignPanel
                  ids={{
                    organizationId: model.organization.id,
                    projectId: onboarding.projectId,
                    controlId: selected,
                  }}
                  design={design}
                  canAct={editable}
                />
              </div>
            </section>
          ) : null}
        </RecordDialog>
      ) : null}
      {active === "it" ? (
        <SystemsCard
          model={model}
          onboarding={onboarding}
          editable={editable}
          selected={system}
        />
      ) : null}
      {active === "business" ? (
        <ProcessesCard
          model={model}
          onboarding={onboarding}
          editable={editable}
          selected={editing?.processId ?? editing?.domain ?? null}
        />
      ) : null}
      {active === "reports" ? (
        <ReportsCard
          model={model}
          onboarding={onboarding}
          editable={editable}
          selected={editing?.controlRef ?? null}
        />
      ) : null}
    </>
  );
}

/** The two ways to set up the controls: the firm's standard library (once a system is in
 * scope) or the client's RCM. */
export function ControlOptions({
  model,
  onboarding,
  editable,
}: {
  model: Ready;
  onboarding: Onboarding;
  editable: boolean;
}) {
  return (
    <div className="rcm-options">
      <section className="card rcm-option">
        <div className="setup-hero-body">
          <span className="agent-mark agent-mark-lg" aria-hidden="true">
            <UiIcon name="shield" size={22} />
          </span>
          <div>
            <h2>Start from the standard library</h2>
            <p>
              {onboarding.library.reduce((sum, area) => sum + area.controls, 0)}{" "}
              reviewed controls: IT general controls, application controls and
              key reports, and starter controls for each business cycle, each
              with its risk, test attributes, suggested evidence, and workpaper
              templates. Choose the areas in scope.
            </p>
          </div>
        </div>
        {editable && onboarding.applications.length > 0 ? (
          <LibraryPicker model={model} onboarding={onboarding} />
        ) : editable ? (
          <p className="card-footer library-locked">
            <UiIcon name="info" size={14} />
            Add at least one in-scope system first. Each control is set up once
            per system it runs on.
          </p>
        ) : null}
      </section>
      <section className="card rcm-option">
        <div className="setup-hero-body">
          <span className="agent-mark agent-mark-lg" aria-hidden="true">
            <UiIcon name="table" size={22} />
          </span>
          <div>
            <h2>Upload the client's RCM</h2>
            <p>
              Use the client's own matrix, in their format and terms. Match
              their columns to ours; every other column is kept under the
              client's heading.
            </p>
            <ul className="chips">
              <li className="pill">Excel .xlsx</li>
              <li className="pill">CSV</li>
              <li className="pill">Any column names</li>
            </ul>
          </div>
        </div>
        {editable ? (
          <div className="card-footer">
            <RcmUploadForm model={model} onboarding={onboarding} />
          </div>
        ) : null}
      </section>
    </div>
  );
}

/** A label in a sentence: lower case, except an acronym such as "IT". */
function lowerLabel(label: string): string {
  const [first = "", ...rest] = label.split(" ");
  const word = /^[A-Z]{2,}$/.test(first) ? first : first.toLowerCase();
  return [word, ...rest.map((item) => item.toLowerCase())].join(" ");
}

/** The systems the controls run on. They come first: each control is one per system. */
export function SystemsCard({
  model,
  onboarding,
  editable,
  selected = null,
}: {
  model: Ready;
  onboarding: Onboarding;
  editable: boolean;
  selected?: string | null;
}) {
  return (
    <>
      <SystemsScoping
        model={model}
        onboarding={onboarding}
        editable={editable}
        selected={selected}
      />
      <SocReportsCard onboarding={onboarding} />
    </>
  );
}

/** The SOC 1 reports to address: each system the agent found relies on a service
 * organization, or could not decide, or that has a report uploaded. A list for the client to
 * consider; nothing here is tracked or decided. */
export function SocReportsCard({ onboarding }: { onboarding: Onboarding }) {
  const items = socOverview(onboarding);
  if (items.length === 0) {
    return null;
  }
  return (
    <section className="card soc-reports" aria-labelledby="soc-reports-title">
      <CardHeader
        title="SOC 1 reports to address"
        titleId="soc-reports-title"
        description="For each, consider the period the report covers and any gap to period end, the service auditor's opinion and exceptions, and the controls it expects the client to operate (KPMG ICFR Handbook (2025), chapter 8). Upload the report on the system to read its CUECs."
        aside={<span className="pill num">{items.length}</span>}
      />
      <div className="card-body">
        <ul className="soc-list">
          {items.map((item) => (
            <li key={item.systemId}>
              <div className="soc-head">
                <strong>{item.name}</strong>
                <span className="soc-meta">
                  {item.status === null
                    ? "SOC 1 not assessed"
                    : SOC_STATUS_LABELS[item.status]}
                  {item.provider !== "" ? ` · ${item.provider}` : ""}
                </span>
              </div>
              <p>
                {item.reports > 0
                  ? `${item.reports} report${item.reports === 1 ? "" : "s"} read`
                  : item.availability === "STATED_AVAILABLE"
                    ? "The vendor states it issues a SOC 1 report. Upload it to read its CUECs."
                    : "No SOC 1 report uploaded yet."}
                {item.sources.length > 0 ? (
                  <>
                    {" "}
                    Source:{" "}
                    <a
                      href={item.sources[0]?.url}
                      target="_blank"
                      rel="noreferrer noopener"
                    >
                      {item.sources[0]?.title || item.sources[0]?.url}
                    </a>
                  </>
                ) : null}
              </p>
              {item.cuecs > 0 ? (
                <p
                  className={item.unaddressed.length > 0 ? "soc-gap" : "soc-ok"}
                >
                  {item.unaddressed.length > 0
                    ? `${item.unaddressed.length} of ${item.cuecs} CUECs have no control in scope: ${item.unaddressed.join(", ")}`
                    : `All ${item.cuecs} CUECs are mapped to a control in scope`}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function RcmTabs({
  model,
  controls,
  active,
}: {
  model: Ready;
  controls: SetupControl[];
  active: ControlCategory;
}) {
  return (
    <nav className="rcm-tabs" aria-label="Control types">
      {CONTROL_CATEGORIES.map((item) => {
        const rows = controls.filter(
          (control) => categoryOf(control.domain) === item.id,
        );
        const inScope = rows.filter((control) => control.included).length;
        return (
          <a
            key={item.id}
            href={setupHref(model, "controls", { category: item.id })}
            aria-current={item.id === active ? "page" : undefined}
            className="rcm-tab"
          >
            <span className="rcm-tab-head">
              <strong>{item.label}</strong>
              <span className="pill num">{inScope}</span>
            </span>
            <small>
              {/* Only what is in scope counts; controls taken out stay listed below. */}
              {inScope === 0
                ? item.detail
                : `${inScope} in scope · ${item.detail}`}
            </small>
          </a>
        );
      })}
    </nav>
  );
}

function RcmUploadForm({
  model,
  onboarding,
  compact = false,
}: {
  model: Ready;
  onboarding: Onboarding;
  compact?: boolean;
}) {
  return (
    <form
      autoComplete="off"
      method="post"
      action="/workspace/setup/rcm-upload"
      encType="multipart/form-data"
      className="rcm-upload"
    >
      <input
        type="hidden"
        name="organization_id"
        value={model.organization.id}
      />
      <input type="hidden" name="project_id" value={onboarding.projectId} />
      <FilePicker
        name="content"
        accept=".xlsx,.xlsm,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        label="Client RCM file"
        chooseLabel={
          compact ? "Upload a new version" : "Choose the client's RCM"
        }
        submitLabel={compact ? "Replace the RCM" : "Upload RCM"}
        primary={!compact}
      />
    </form>
  );
}

function RcmSource({
  model,
  onboarding,
  editable,
}: {
  model: Ready;
  onboarding: Onboarding;
  editable: boolean;
}) {
  const uploaded = onboarding.rcmSource === "UPLOAD";
  return (
    <section className="card rcm-source" aria-label="RCM source">
      <div className="rcm-source-body">
        <span className="agent-mark" aria-hidden="true">
          <UiIcon name={uploaded ? "table" : "shield"} size={18} />
        </span>
        <div className="row-text">
          <strong>
            {uploaded
              ? `Client RCM${onboarding.rcmFileName === "" ? "" : `: ${onboarding.rcmFileName}`}`
              : "Standard library"}
          </strong>
          <small>
            {uploaded
              ? "Imported in the client's terms. Area, frequency, and nature are mapped to standard values for testing."
              : "Reviewed controls, tailored for this engagement."}
          </small>
        </div>
        {editable && !onboarding.started ? (
          <div className="rcm-source-actions">
            <RcmUploadForm model={model} onboarding={onboarding} compact />
          </div>
        ) : null}
      </div>
      {editable &&
      !onboarding.started &&
      (uploaded ||
        onboarding.library.some((area) => area.loaded < area.controls)) ? (
        <details className="rcm-library-more">
          <summary>
            {uploaded
              ? "Use the standard library instead"
              : "Add more areas from the library"}
          </summary>
          {uploaded ? (
            <p className="form-hint">
              Loading the library replaces the uploaded controls.
            </p>
          ) : null}
          <LibraryPicker
            model={model}
            onboarding={onboarding}
            adding={!uploaded}
          />
        </details>
      ) : null}
    </section>
  );
}

const VALUE_TITLES: Record<ValueField, { title: string; detail: string }> = {
  domain: {
    title: "Process or area",
    detail: "Decides which tester agent takes the control.",
  },
  frequency: {
    title: "Frequency",
    detail: "Decides the sample size.",
  },
  nature: {
    title: "Nature",
    detail: "Decides the testing workpaper and whether one sample is enough.",
  },
};

const TESTER_LABEL: Record<string, string> = Object.fromEntries(TESTERS);

/** Area options grouped into IT, application and data, and business cycles. */
function DomainOptions({ only }: { only?: ControlCategory }) {
  return (
    <>
      {CONTROL_CATEGORIES.filter(
        (group) => only === undefined || group.id === only,
      ).map((group) => (
        <optgroup key={group.label} label={group.label}>
          {group.domains.map(([key, label]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </optgroup>
      ))}
    </>
  );
}

function LibraryPicker({
  model,
  onboarding,
  adding = false,
}: {
  model: Ready;
  onboarding: Onboarding;
  adding?: boolean;
}) {
  const areas = new Map(onboarding.library.map((area) => [area.domain, area]));
  const groups = DOMAIN_GROUPS.map((group) => ({
    label: group.label,
    domains: group.domains.filter(([key]) => {
      const area = areas.get(key);
      return area !== undefined && (!adding || area.loaded < area.controls);
    }),
  })).filter((group) => group.domains.length > 0);
  if (groups.length === 0) {
    return null;
  }
  return (
    <form
      autoComplete="off"
      method="post"
      action="/workspace/setup"
      className="library-picker"
    >
      <Identity
        model={model}
        onboarding={onboarding}
        intent="load-library"
        step="controls"
      />
      <div className="library-groups">
        {groups.map((group) => (
          <fieldset key={group.label}>
            <legend>{group.label}</legend>
            {group.domains.map(([key, label]) => (
              <label key={key} className="check" htmlFor={`library-${key}`}>
                <input
                  id={`library-${key}`}
                  type="checkbox"
                  name="domains"
                  value={key}
                  // The frameworks chosen when the engagement was created, else
                  // the IT general controls.
                  defaultChecked={
                    !adding && areaSelected(key, onboarding.frameworks)
                  }
                />
                {label}
                <small className="cell-sub">
                  {areas.get(key)?.controls ?? 0}
                </small>
              </label>
            ))}
          </fieldset>
        ))}
      </div>
      <div className="form-actions">
        <button
          type="submit"
          className={adding ? "btn-secondary btn-sm" : undefined}
        >
          <UiIcon name="plus" size={15} />{" "}
          {adding ? "Add selected areas" : "Load selected areas"}
        </button>
      </div>
    </form>
  );
}

function RcmImportView({
  model,
  onboarding,
  upload,
}: {
  model: Ready;
  onboarding: Onboarding;
  upload: RcmImport;
}) {
  const fieldLabel = Object.fromEntries(
    upload.fields.map((field) => [field.key, field.label]),
  );
  const mapped = new Set(upload.columns.map((column) => column.field));
  const missingRequired = upload.fields.filter(
    (field) => field.required && !mapped.has(field.key),
  );
  let valueIndex = 0;
  const preview = upload.preview;
  return (
    <>
      <section className="card rcm-source" aria-label="Uploaded file">
        <div className="rcm-source-body">
          <span className="agent-mark" aria-hidden="true">
            <UiIcon name="table" size={18} />
          </span>
          <div className="row-text">
            <strong>{upload.fileName}</strong>
            <small className="upload-owner">
              Uploaded to {onboarding.projectName}
              {upload.createdAt !== ""
                ? ` on ${formatDate(upload.createdAt)}`
                : ""}
              {upload.uploadedBy !== "" ? ` by ${upload.uploadedBy}` : ""}. Not
              imported yet: import it or discard it.
            </small>
            <small>
              {upload.fileKind === "XLSX" ? "Excel workbook" : "CSV"} ·{" "}
              {formatSize(upload.sizeBytes)} · {upload.dataRows} rows below the
              header · Only cell values were read. Formulas, macros, and links
              were not run.
            </small>
          </div>
          <form autoComplete="off" method="post" action="/workspace/setup">
            <Identity
              model={model}
              onboarding={onboarding}
              intent="rcm-discard"
              step="controls"
            />
            <input type="hidden" name="import_id" value={upload.id} />
            <button type="submit" className="btn-secondary btn-sm">
              Discard upload
            </button>
          </form>
        </div>
        <form
          autoComplete="off"
          method="post"
          action="/workspace/setup"
          className="toolbar rcm-layout"
        >
          <Identity
            model={model}
            onboarding={onboarding}
            intent="rcm-layout"
            step="controls"
          />
          <input type="hidden" name="import_id" value={upload.id} />
          <input type="hidden" name="version" value={upload.version} />
          {upload.sheets.length > 1 ? (
            <label htmlFor="rcm-sheet">
              Sheet
              <select
                id="rcm-sheet"
                name="sheet_index"
                defaultValue={String(upload.sheetIndex)}
              >
                {upload.sheets.map((sheet) => (
                  <option key={sheet.index} value={sheet.index}>
                    {sheet.name} ({sheet.rows} rows)
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <input type="hidden" name="sheet_index" value={upload.sheetIndex} />
          )}
          <label htmlFor="rcm-header">
            Headings are in row
            <input
              id="rcm-header"
              name="header_row"
              type="number"
              min={1}
              max={100}
              defaultValue={upload.headerRow}
            />
          </label>
          <button type="submit" className="btn-secondary btn-sm">
            Re-read the sheet
          </button>
          <span className="form-hint">
            Changing the sheet or heading row suggests the columns again.
          </span>
        </form>
      </section>

      <form
        autoComplete="off"
        method="post"
        action="/workspace/setup"
        className="stack"
      >
        <Identity
          model={model}
          onboarding={onboarding}
          intent="rcm-mapping"
          step="controls"
        />
        <input type="hidden" name="import_id" value={upload.id} />
        <input type="hidden" name="version" value={upload.version} />
        <section className="card" aria-labelledby="rcm-columns-title">
          <CardHeader
            title="1. Match the client's columns"
            titleId="rcm-columns-title"
            description="Suggested from the headings and the values in each column, and from how this engagement's earlier RCMs were mapped. The process or area can come from two columns read together: a category such as ITGC or Business Process, and the process itself. A column holding preventive or detective is the control's type, kept as a client column. Columns you keep as client columns appear on each control and its workpapers under the client's heading."
            aside={<span className="num">{upload.columns.length} columns</span>}
          />
          {missingRequired.length > 0 ? (
            <div className="card-body">
              <ul className="setup-issues">
                {missingRequired.map((field) => (
                  <li key={field.key}>
                    <UiIcon name="info" size={14} />
                    Choose the column that holds the {field.label.toLowerCase()}
                    .
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <div className="table-wrap">
            <table className="table rcm-map">
              <thead>
                <tr>
                  <th scope="col">Client column</th>
                  <th scope="col">Sample values</th>
                  <th scope="col">Use as</th>
                </tr>
              </thead>
              <tbody>
                {upload.columns.map((column) => (
                  <tr key={column.index}>
                    <td>
                      <strong>{column.header}</strong>
                    </td>
                    <td>
                      {column.samples.length === 0 ? (
                        <span className="muted">Empty</span>
                      ) : (
                        <ul className="rcm-samples">
                          {uniqueKeys(column.samples, (sample) => sample).map(
                            ([key, sample]) => (
                              <li key={key}>{sample}</li>
                            ),
                          )}
                        </ul>
                      )}
                    </td>
                    <td>
                      <select
                        name={`column_${column.index}`}
                        defaultValue={column.field}
                        aria-label={`Use ${column.header} as`}
                      >
                        <optgroup label="Platform field">
                          {upload.fields.map((field) => (
                            <option key={field.key} value={field.key}>
                              {field.label}
                              {field.required ? " (required)" : ""}
                            </option>
                          ))}
                        </optgroup>
                        <optgroup label="Other">
                          <option value="custom">Keep as client column</option>
                          <option value="ignore">Do not import</option>
                        </optgroup>
                      </select>
                      {column.field !== column.suggested &&
                      column.suggested !== "custom" ? (
                        <small className="cell-sub">
                          Suggested: {fieldLabel[column.suggested]}
                        </small>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="card" aria-labelledby="rcm-values-title">
          <CardHeader
            title="2. Map the client's terms"
            titleId="rcm-values-title"
            description="The client's terms are kept and shown on every control. The standard value beside each one decides how it is tested. Suggestions come from the controls that use each term; change any of them."
            aside={<TermsStatus terms={upload.terms} />}
          />
          {upload.terms.status === "PENDING" ||
          upload.terms.status === "WORKING" ? (
            <div className="card-body systems-working" aria-live="polite">
              <AutoRefresh />
              <span className="spinner" aria-hidden="true" />
              <div>
                <strong>
                  {upload.terms.mode === "REMAP"
                    ? "The agent is mapping every term again."
                    : "The agent is mapping the terms that are still blank."}
                </strong>
                <p className="form-hint">
                  It reads the controls that use each term. This page updates by
                  itself.
                </p>
              </div>
            </div>
          ) : null}
          <div className="rcm-values">
            {VALUE_FIELDS.map((field) => {
              const items = upload.values[field];
              // The area can come from two columns, read together.
              const sources = upload.columns.filter((c) => c.field === field);
              return (
                <div key={field} className="rcm-value-group">
                  <h3 className="card-subhead">{VALUE_TITLES[field].title}</h3>
                  <p className="form-hint">
                    {sources.length === 0
                      ? "No column is matched, so one value applies to every control. "
                      : sources.length === 1
                        ? `From "${sources[0]?.header}". `
                        : `From ${sources.map((c) => `"${c.header}"`).join(" and ")}, read together. `}
                    {VALUE_TITLES[field].detail}
                  </p>
                  <table className="table rcm-value-table">
                    <thead>
                      <tr>
                        <th scope="col">Client term</th>
                        <th scope="col" className="cell-num">
                          Rows
                        </th>
                        <th scope="col">Standard value</th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((item) => {
                        const index = valueIndex;
                        valueIndex += 1;
                        return (
                          <tr key={`${field}-${item.value}`}>
                            <td>
                              <input
                                type="hidden"
                                name={`value_field_${index}`}
                                value={field}
                              />
                              <input
                                type="hidden"
                                name={`value_raw_${index}`}
                                value={item.value}
                              />
                              {item.value === "" ? (
                                <span className="muted">
                                  {sources.length === 0
                                    ? "Every control"
                                    : "(blank)"}
                                </span>
                              ) : (
                                item.value
                              )}
                            </td>
                            <td className="cell-num num">{item.count}</td>
                            <td>
                              <select
                                name={`value_mapped_${index}`}
                                defaultValue={item.mapped ?? ""}
                                aria-label={`Standard value for ${item.value || "blank"}`}
                                className={
                                  item.mapped === null ? "select-missing" : ""
                                }
                              >
                                <option value="">Choose…</option>
                                {field === "domain" ? (
                                  <DomainOptions />
                                ) : (
                                  VALUE_OPTIONS[field].map(([key, label]) => (
                                    <option key={key} value={key}>
                                      {label}
                                    </option>
                                  ))
                                )}
                              </select>
                              {item.alternative !== null ? (
                                <small className="term-reason term-alternative">
                                  Agent suggests{" "}
                                  {VALUE_OPTIONS[field].find(
                                    ([key]) => key === item.alternative,
                                  )?.[1] ?? item.alternative}
                                  {item.alternativeReason !== ""
                                    ? `: ${item.alternativeReason}`
                                    : ""}
                                </small>
                              ) : null}
                              {item.reason !== "" ? (
                                <small
                                  className={`term-reason ${item.mappedBy === "MODEL" ? "term-reason-agent" : ""}`}
                                >
                                  {item.mappedBy === "MODEL"
                                    ? "Agent: "
                                    : "Rules: "}
                                  {item.reason}
                                </small>
                              ) : null}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              );
            })}
          </div>
          <div className="card-footer rcm-save">
            <span className="form-hint">
              After you change which column holds area, frequency, or nature,
              save to see that column's terms here.
            </span>
            <button type="submit">Save and preview</button>
          </div>
        </section>
      </form>

      <form
        autoComplete="off"
        method="post"
        action="/workspace/setup"
        className="terms-agent"
      >
        <Identity
          model={model}
          onboarding={onboarding}
          intent="rcm-remap-terms"
          step="controls"
        />
        <input type="hidden" name="import_id" value={upload.id} />
        <span className="form-hint">
          {upload.terms.modelAvailable
            ? "Have the agent map every term again from the controls that use it. This replaces the current choices; you review them before import."
            : "AI mapping is not available in this workspace, so remapping restores the standard suggestions."}
        </span>
        <button
          type="submit"
          className="btn-secondary btn-sm"
          disabled={
            upload.terms.status === "PENDING" ||
            upload.terms.status === "WORKING"
          }
        >
          <UiIcon name="sparkles" size={14} />{" "}
          {upload.terms.modelAvailable
            ? "Remap with agent"
            : "Reset to suggested"}
        </button>
      </form>

      <RcmSystemsCard
        model={model}
        onboarding={onboarding}
        importId={upload.id}
        systems={upload.systems}
      />

      <section className="card" aria-labelledby="rcm-preview-title">
        <CardHeader
          title="4. Preview and import"
          titleId="rcm-preview-title"
          description={
            onboarding.rcmSource === "UPLOAD" && upload.replaces > 0
              ? `This sheet can join the ${upload.replaces} controls already imported, for an RCM kept on several sheets, or replace them. A control with the same ID is replaced by its new row. Importing asks for the workpaper templates to be confirmed again.`
              : upload.replaces > 0
                ? `Importing replaces the ${upload.replaces} controls in this engagement and asks for the workpaper templates to be confirmed again.`
                : "Importing creates the engagement's RCM. You can still tailor every control afterwards."
          }
        />
        <div className="card-body stack">
          <section className="kpis kpis-compact" aria-label="Import summary">
            <article className="kpi">
              <p className="kpi-label">Controls to import</p>
              <strong className="kpi-value">{preview.importable}</strong>
              <span className="kpi-detail">of {upload.dataRows} rows</span>
            </article>
            <article
              className={`kpi ${preview.skippedCount > 0 ? "kpi-risk" : ""}`}
            >
              <p className="kpi-label">Rows skipped</p>
              <strong className="kpi-value">{preview.skippedCount}</strong>
              <span className="kpi-detail">Listed below</span>
            </article>
            <article className="kpi">
              <p className="kpi-label">New applications</p>
              <strong className="kpi-value">
                {preview.newApplications.length}
              </strong>
              <span className="kpi-detail">
                {preview.newApplications.slice(0, 3).join(", ") ||
                  "None to add"}
              </span>
            </article>
          </section>
          {preview.problems.length > 0 ? (
            <ul className="setup-issues">
              {preview.problems.map((problem) => (
                <li key={problem}>
                  <UiIcon name="info" size={14} />
                  {problem}
                </li>
              ))}
            </ul>
          ) : null}
          {preview.warnings.map((warning) => (
            <Banner key={warning} tone="warning">
              {warning}
            </Banner>
          ))}
          {preview.controls.length > 0 ? (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th scope="col">Control</th>
                    <th scope="col">Area</th>
                    <th scope="col">Frequency</th>
                    <th scope="col">Nature</th>
                    <th scope="col">Owner</th>
                    <th scope="col">Match</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.controls.map((control) => (
                    <tr key={control.row}>
                      <td>
                        <div className="cell-request">
                          <span className="mono item-ref">
                            {control.controlRef}
                            {control.keyControl ? "" : " · Non-key"}
                          </span>
                          <span>{control.title}</span>
                          <small>
                            Row {control.row}
                            {control.customFields > 0
                              ? ` · ${control.customFields} client column${control.customFields === 1 ? "" : "s"}`
                              : ""}
                          </small>
                        </div>
                      </td>
                      <td>
                        <MappedTerm
                          client={control.domainLabel}
                          standard={AREA_LABEL[control.domain] ?? ""}
                        />
                      </td>
                      <td>
                        <MappedTerm
                          client={control.frequencyLabel}
                          standard={FREQUENCY_LABEL[control.frequency] ?? ""}
                        />
                      </td>
                      <td>
                        <MappedTerm
                          client={control.natureLabel}
                          standard={NATURE_LABEL[control.nature] ?? ""}
                        />
                      </td>
                      <td>
                        <span className="cell-stack">
                          <span>{control.ownerName || "Not named"}</span>
                          <small className="cell-sub">
                            {control.ownerEmail || "No email"}
                          </small>
                        </span>
                      </td>
                      <td>
                        <span className="st-status is-in">
                          <i aria-hidden="true" />
                          Matched
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
          {preview.importable > preview.controls.length ? (
            <p className="form-hint">
              Showing the first {preview.controls.length} of{" "}
              {preview.importable} controls.
            </p>
          ) : null}
          {preview.skippedCount > 0 ? (
            <details className="rcm-skipped">
              <summary>
                {preview.skippedCount} row
                {preview.skippedCount === 1 ? " is" : "s are"} skipped
              </summary>
              <ul>
                {preview.skipped.map((item) => (
                  <li key={item.row}>
                    <span className="mono">Row {item.row}</span> {item.reason}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </div>
        <div className="card-footer rcm-save">
          <span className="form-hint">
            {upload.ready
              ? "Nothing is sent to the client. Owners, scope, and templates can be adjusted after import."
              : "Resolve the items above, then save the mapping."}
          </span>
          <form autoComplete="off" method="post" action="/workspace/setup">
            <Identity
              model={model}
              onboarding={onboarding}
              intent="rcm-import"
              step="controls"
            />
            <input type="hidden" name="import_id" value={upload.id} />
            <input type="hidden" name="version" value={upload.version} />
            {onboarding.rcmSource === "UPLOAD" && upload.replaces > 0 ? (
              <select
                name="mode"
                aria-label="What to do with the controls already imported"
                defaultValue="ADD"
              >
                <option value="ADD">
                  Add to the {upload.replaces} controls already imported
                </option>
                <option value="REPLACE">
                  Replace the {upload.replaces} controls already imported
                </option>
              </select>
            ) : null}
            <button type="submit" disabled={!upload.ready}>
              <UiIcon name="check" size={15} /> Import {preview.importable}{" "}
              controls
            </button>
          </form>
        </div>
      </section>
    </>
  );
}

function TermsStatus({ terms }: { terms: RcmImport["terms"] }) {
  if (terms.status === "PENDING" || terms.status === "WORKING") {
    return <span className="pill pill-dot tone-info">Agent is mapping</span>;
  }
  if (terms.status === "FAILED") {
    return (
      <span className="pill pill-dot tone-warning">Mapping did not finish</span>
    );
  }
  return terms.source === "MODEL" ? (
    <span className="pill pill-dot tone-success">Mapped by an agent</span>
  ) : (
    <span className="pill pill-dot">Suggested by rules</span>
  );
}

function RcmSystemsCard({
  model,
  onboarding,
  importId,
  systems,
}: {
  model: Ready;
  onboarding: Onboarding;
  importId: string;
  systems: RcmSystems;
}) {
  const working = systems.status === "PENDING" || systems.status === "SCANNING";
  const rescan = (
    <form autoComplete="off" method="post" action="/workspace/setup">
      <Identity
        model={model}
        onboarding={onboarding}
        intent="rcm-rescan"
        step="controls"
      />
      <input type="hidden" name="import_id" value={importId} />
      <button type="submit" className="btn-secondary btn-sm">
        <UiIcon name="sparkles" size={14} /> Scan again
      </button>
    </form>
  );
  return (
    <section className="card" aria-labelledby="rcm-systems-title">
      <CardHeader
        title="3. Confirm the in-scope systems"
        titleId="rcm-systems-title"
        description="An agent found the systems your controls rely on, from the systems column and the control text. Rename a system, set its layer, or leave it out. Importing makes these the engagement's in-scope applications."
        aside={
          systems.status === "READY" ? (
            <span
              className={`pill pill-dot ${systems.source === "MODEL" ? "tone-success" : ""}`}
            >
              {systems.source === "MODEL"
                ? "Identified by an agent"
                : "Identified from the RCM"}
            </span>
          ) : undefined
        }
      />
      {working ? (
        <div className="card-body systems-working" aria-live="polite">
          <AutoRefresh />
          <span className="spinner" aria-hidden="true" />
          <div>
            <strong>
              The agent is reading the RCM to identify the systems.
            </strong>
            <p className="form-hint">
              This page updates by itself. Importing now uses only the systems
              column.
            </p>
          </div>
        </div>
      ) : systems.status === "FAILED" ? (
        <div className="card-body stack">
          <Banner tone="warning">
            Identifying the systems did not finish. Scan again, or import using
            the systems column only.
          </Banner>
          {rescan}
        </div>
      ) : systems.proposals.length === 0 ? (
        <div className="card-body stack">
          <p className="form-hint">
            No system is named in this RCM. Map the column that lists them and
            save, or add the systems after import.
          </p>
          {rescan}
        </div>
      ) : (
        <form autoComplete="off" method="post" action="/workspace/setup">
          <Identity
            model={model}
            onboarding={onboarding}
            intent="rcm-systems"
            step="controls"
          />
          <input type="hidden" name="import_id" value={importId} />
          <input type="hidden" name="systems_version" value={systems.version} />
          <div className="table-wrap">
            <table className="table rcm-systems">
              <thead>
                <tr>
                  <th scope="col">In scope</th>
                  <th scope="col">System</th>
                  <th scope="col">Layer</th>
                  <th scope="col">Found in</th>
                </tr>
              </thead>
              <tbody>
                {systems.proposals.map((system, index) => (
                  <tr key={system.key}>
                    <td>
                      <input
                        type="hidden"
                        name={`system_key_${index}`}
                        value={system.key}
                      />
                      <input
                        type="checkbox"
                        name={`system_included_${index}`}
                        defaultChecked={system.included}
                        aria-label={`Keep ${system.name} in scope`}
                      />
                    </td>
                    <td>
                      <input
                        name={`system_name_${index}`}
                        defaultValue={system.name}
                        maxLength={120}
                        required
                        aria-label={`Name for ${system.name}`}
                      />
                      {system.aliases.length > 0 ? (
                        <small className="cell-sub">
                          Also written as{" "}
                          {system.aliases.slice(0, 4).join(", ")}
                        </small>
                      ) : null}
                    </td>
                    <td>
                      <select
                        name={`system_layer_${index}`}
                        defaultValue={system.layer}
                        aria-label={`Layer for ${system.name}`}
                      >
                        {LAYERS.map(([key, label]) => (
                          <option key={key} value={key}>
                            {label}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <span className="cell-stack">
                        <span>
                          {system.controls} control
                          {system.controls === 1 ? "" : "s"}
                          <span className="cell-sub">
                            {" "}
                            · {system.controlRefs.slice(0, 3).join(", ")}
                            {system.controlRefs.length > 3 ? "…" : ""}
                          </span>
                        </span>
                        <small className="cell-sub">
                          {system.foundIn === "column"
                            ? "Systems column"
                            : system.foundIn === "text"
                              ? "Control text only"
                              : "Systems column and control text"}
                          {system.evidence !== "" && system.foundIn !== "column"
                            ? ` · “${system.evidence}”`
                            : ""}
                        </small>
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="card-footer rcm-save">
            <span className="form-hint">
              {systems.note !== "" ? `${systems.note} ` : ""}
              {systems.proposals.filter((system) => system.included).length} of{" "}
              {systems.proposals.length} systems in scope.
            </span>
            <span className="rcm-systems-actions">
              <button type="submit" formAction="/workspace/setup">
                Save systems
              </button>
            </span>
          </div>
        </form>
      )}
      {systems.status === "READY" && systems.proposals.length > 0 ? (
        <div className="card-footer rcm-rescan">{rescan}</div>
      ) : null}
    </section>
  );
}

function MappedTerm({
  client,
  standard,
}: {
  client: string;
  standard: string;
}) {
  if (client === "" || client.toLowerCase() === standard.toLowerCase()) {
    return <span>{standard}</span>;
  }
  return (
    <span className="cell-stack">
      <span>{client}</span>
      <small className="cell-sub">{standard}</small>
    </span>
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${Math.round(bytes / 1024)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** What kind of control is open, and every system it is tested for, above its title.
 * The editor edits the control on all of them at once. */
function controlEyebrow(control: SetupControl, onboarding: Onboarding): string {
  const kind = kindForDomain(control.domain);
  const label =
    kind === "ITGC"
      ? "IT general control"
      : kind === "ITAC"
        ? "Application control"
        : kind === "KEY_REPORT"
          ? "Key report"
          : "Business process control";
  const systems = onboarding.applications
    .filter((app) => control.applicationIds.includes(app.id))
    .map((app) => app.name);
  return systems.length > 0 ? `${label} · ${systems.join(", ")}` : label;
}

function ControlEditor({
  model,
  onboarding,
  control,
  editable,
  framed = true,
  returnTo,
}: {
  model: Ready;
  onboarding: Onboarding;
  control: SetupControl;
  editable: boolean;
  /** In its own card with a title; inside a record dialog the dialog has the title. */
  framed?: boolean;
  /** Where saving returns: the tab and the system open underneath. */
  returnTo?: { category: string; system: string | null };
}) {
  const kind = kindForDomain(control.domain);
  const templates = onboarding.templates.filter((t) => t.kind === kind);
  return (
    <section
      className={`card control-editor${framed ? "" : " is-in-dialog"}`}
      aria-labelledby={framed ? "control-title" : "record-dialog-title"}
    >
      {framed ? (
        <CardHeader
          title={`${control.controlRef} ${control.title}`}
          titleId="control-title"
          description={control.activity}
          aside={
            <a
              className="text-link"
              href={setupHref(model, "controls", {
                category: categoryOf(control.domain),
              })}
            >
              Close
            </a>
          }
        />
      ) : null}
      <div className="card-body control-editor-body">
        <div className="stack">
          {control.risk !== "" ? (
            <div>
              <h3 className="card-subhead">Risk</h3>
              <p className="prose">{control.risk}</p>
            </div>
          ) : null}
          {control.source === "UPLOAD" ? (
            <div>
              <h3 className="card-subhead">In the client's terms</h3>
              <dl className="client-fields">
                {[
                  [
                    "Process or area",
                    control.domainLabel,
                    AREA_LABEL[control.domain],
                  ],
                  [
                    "Frequency",
                    control.frequencyLabel,
                    FREQUENCY_LABEL[control.frequency],
                  ],
                  ["Nature", control.natureLabel, NATURE_LABEL[control.nature]],
                ].map(([label, client, standard]) => (
                  <div key={label}>
                    <dt>{label}</dt>
                    <dd>
                      {client || "Not given"}
                      <small className="cell-sub">Tested as {standard}</small>
                    </dd>
                  </div>
                ))}
                {uniqueKeys(control.customFields, (field) => field.label).map(
                  ([key, field]) => (
                    <div key={key}>
                      <dt>{field.label}</dt>
                      <dd>{field.value}</dd>
                    </div>
                  ),
                )}
              </dl>
            </div>
          ) : null}
          <div>
            <h3 className="card-subhead">Test attributes</h3>
            <ol className="attribute-list">
              {uniqueKeys(control.testAttributes, (item) => item).map(
                ([key, attribute]) => (
                  <li key={key}>{attribute}</li>
                ),
              )}
            </ol>
          </div>
          <div>
            <h3 className="card-subhead">Evidence requested</h3>
            <ul className="attribute-list">
              {uniqueKeys(control.pbcItems, (entry) => entry).map(
                ([key, item]) => (
                  <li key={key}>{item}</li>
                ),
              )}
            </ul>
          </div>
        </div>
        <form
          autoComplete="off"
          method="post"
          action="/workspace/setup"
          className="form"
        >
          <Identity
            model={model}
            onboarding={onboarding}
            intent="control"
            step="controls"
          />
          <input type="hidden" name="control_id" value={control.id} />
          <input type="hidden" name="return_control" value={control.id} />
          {returnTo !== undefined ? (
            <>
              <input
                type="hidden"
                name="return_category"
                value={returnTo.category}
              />
              {returnTo.system !== null ? (
                <input
                  type="hidden"
                  name="return_system"
                  value={returnTo.system}
                />
              ) : null}
            </>
          ) : null}
          <input type="hidden" name="version" value={control.version} />
          <label className="check field-wide" htmlFor="control-included">
            <input
              id="control-included"
              name="included"
              type="checkbox"
              defaultChecked={control.included}
              disabled={!editable}
            />
            In scope for this engagement
          </label>
          <label className="check field-wide" htmlFor="control-key">
            <input
              id="control-key"
              name="key_control"
              type="checkbox"
              defaultChecked={control.keyControl}
              disabled={!editable}
            />
            Key control
          </label>
          <label htmlFor="control-owner-name">
            Owner
            <input
              id="control-owner-name"
              name="owner_name"
              maxLength={200}
              defaultValue={control.ownerName}
              disabled={!editable}
            />
          </label>
          <label htmlFor="control-owner-email">
            Owner email
            <input
              id="control-owner-email"
              name="owner_email"
              type="email"
              defaultValue={control.ownerEmail}
              disabled={!editable}
            />
          </label>
          <label htmlFor="control-frequency">
            Frequency
            <select
              id="control-frequency"
              name="frequency"
              defaultValue={control.frequency}
              disabled={!editable}
            >
              {FREQUENCIES.map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label htmlFor="control-nature">
            Nature
            <select
              id="control-nature"
              name="nature"
              defaultValue={control.nature}
              disabled={!editable}
            >
              {NATURES.map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label htmlFor="control-domain">
            Area
            <select
              id="control-domain"
              name="domain"
              defaultValue={control.domain}
              disabled={!editable}
            >
              <DomainOptions />
            </select>
          </label>
          <label htmlFor="control-tester">
            Tester
            <select
              id="control-tester"
              name="agent_key"
              defaultValue={
                control.agentKey === domainTester(control.domain)
                  ? ""
                  : control.agentKey
              }
              disabled={!editable}
            >
              <option value="">Standard for the area</option>
              {TESTERS.map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
            <span className="form-hint">
              Assigned to {TESTER_LABEL[control.agentKey] ?? control.agentKey}
            </span>
          </label>
          <label htmlFor="control-template">
            Workpaper template
            <select
              id="control-template"
              name="template_key"
              defaultValue={control.templateKey}
              disabled={!editable}
            >
              {templates.map((template) => (
                <option key={template.key} value={template.key}>
                  {template.title}
                  {template.source === "FIRM" ? " (your firm)" : ""}
                </option>
              ))}
            </select>
            <span className="form-hint">
              One workbook: design, interim testing, and roll-forward tabs.
            </span>
          </label>
          {categoryOf(control.domain) === "business" ? (
            <p className="form-hint field-wide">
              A business process control belongs to its process, not a system.
            </p>
          ) : (
            <fieldset className="field-wide app-picker" disabled={!editable}>
              <legend>Systems</legend>
              <span className="form-hint">
                The control is requested, tested, and concluded once per system.
              </span>
              {onboarding.applications.length === 0 ? (
                <span className="form-hint">
                  Add the in-scope systems above first.
                </span>
              ) : (
                onboarding.applications.map((app) => (
                  <label
                    key={app.id}
                    className="check"
                    htmlFor={`app-${app.id}`}
                  >
                    <input
                      id={`app-${app.id}`}
                      type="checkbox"
                      name="application_ids"
                      value={app.id}
                      defaultChecked={control.applicationIds.includes(app.id)}
                    />
                    {app.name}
                  </label>
                ))
              )}
            </fieldset>
          )}
          {editable && control.tested ? (
            <div className="tested-note field-wide">
              <p>
                <strong>This control has testing on record.</strong> Its
                approved sample and results rest on its frequency, nature, and
                area. Changing any of them opens a question on the control that
                holds its testing until someone checks whether the results still
                stand.
              </p>
              <label className="check" htmlFor="control-acknowledge">
                <input
                  id="control-acknowledge"
                  name="acknowledge_testing"
                  type="checkbox"
                />
                I understand: save a change to frequency, nature, or area anyway
              </label>
            </div>
          ) : null}
          {editable ? (
            <div className="form-actions">
              <button type="submit">Save control</button>
              <a
                className="btn btn-secondary"
                href={setupHref(model, "workpapers", {
                  template: control.templateKey,
                  sample: control.id,
                })}
              >
                Preview workpaper
              </a>
            </div>
          ) : null}
        </form>
      </div>
    </section>
  );
}

// Step 4

export function WorkpapersStep({
  model,
  onboarding,
  editable,
  setup,
}: {
  model: Ready;
  onboarding: Onboarding;
  editable: boolean;
  setup: SetupState;
}) {
  // One entry per control ID: a preview with any of its per-system copies reads the same.
  const included = families(
    onboarding.controls.filter((control) => control.included),
  );
  const ofKind = (kind: string): SetupControl[] =>
    included.filter((control) => kindForDomain(control.domain) === kind);
  const sampleFor = (template: SetupTemplate): SetupControl | undefined =>
    included.find((control) => control.templateKey === template.key) ??
    ofKind(template.kind)[0];
  const sampled = onboarding.controls.find(
    (control) => control.included && control.id === setup.sample,
  );
  const previewControl =
    sampled === undefined
      ? null
      : (included.find(
          (control) => control.controlRef === sampled.controlRef,
        ) ?? sampled);
  const editing =
    setup.edit === null || setup.edit === undefined
      ? null
      : (onboarding.templates.find(
          (template) =>
            template.source === "FIRM" && template.templateId === setup.edit,
        ) ?? null);
  if (editable && editing !== null) {
    return (
      <TemplateEditor
        organizationId={model.organization.id}
        projectId={onboarding.projectId}
        template={editing}
        cancelHref={setupHref(model, "workpapers")}
      />
    );
  }
  return (
    <>
      <section className="card" aria-labelledby="templates-title">
        <CardHeader
          title="Workpaper templates"
          titleId="templates-title"
          description="One workbook per control, with design, interim testing, and roll-forward tabs. Each kind of control has a standard workbook. Customise one and save it as your firm's, or upload the workpaper your firm uses, then preview it filled in with a real control."
        />
        {onboarding.started && editable ? (
          <p className="templates-after-launch">
            <UiIcon name="info" size={14} />
            <span>
              The engagement is running. A template you change, upload, or apply
              now is used for workpapers that have not started yet. A workpaper
              already started keeps the template it began with.
            </span>
          </p>
        ) : null}
        <div className="template-kinds">
          {TEMPLATE_KINDS.map((kind) => {
            const templates = onboarding.templates.filter(
              (template) => template.kind === kind.id,
            );
            const controls = ofKind(kind.id);
            return (
              <section
                key={kind.id}
                className={`template-kind ${controls.length === 0 ? "is-empty" : ""}`}
                aria-labelledby={`kind-${kind.id}`}
              >
                <header className="template-kind-head">
                  <div>
                    <h3 id={`kind-${kind.id}`}>{kind.label}</h3>
                    <p className="card-desc">{kind.detail}</p>
                  </div>
                  <span className="template-kind-count">
                    {controls.length === 0
                      ? "None in scope"
                      : `${controls.length} in scope`}
                  </span>
                </header>
                <ol className="template-list">
                  {templates.map((template) => (
                    <TemplateRow
                      key={template.key}
                      model={model}
                      onboarding={onboarding}
                      template={template}
                      kindOne={kind.one}
                      uses={
                        controls.filter(
                          (item) => item.templateKey === template.key,
                        ).length
                      }
                      total={controls.length}
                      sample={sampleFor(template)}
                      active={setup.template === template.key}
                      editable={editable}
                    />
                  ))}
                </ol>
              </section>
            );
          })}
        </div>
        {included.length === 0 ? (
          <div className="card-body">
            <Banner tone="warning">
              Load the control library first. Previews use your controls.
            </Banner>
          </div>
        ) : null}
      </section>
      {editable ? (
        <section className="card" aria-labelledby="firm-templates-title">
          <CardHeader
            title="Upload your firm's workpaper"
            titleId="firm-templates-title"
            description="A Word document or an Excel workbook. Sheets or top headings named Design, Interim, and Roll-forward become the tabs, and the headings and tables under each become the sections. A file that covers one tab keeps the standard tabs for the rest."
          />
          <div className="card-body">
            <form
              autoComplete="off"
              method="post"
              action="/workspace/setup/workpaper-upload"
              encType="multipart/form-data"
              className="rcm-upload template-upload"
            >
              <input
                type="hidden"
                name="organization_id"
                value={model.organization.id}
              />
              <input
                type="hidden"
                name="project_id"
                value={onboarding.projectId}
              />
              <label htmlFor="template-kind">
                For which controls
                <select id="template-kind" name="kind" defaultValue="ITGC">
                  {TEMPLATE_KINDS.map((kind) => (
                    <option key={kind.id} value={kind.id}>
                      {kind.label}
                    </option>
                  ))}
                </select>
              </label>
              <label htmlFor="template-part">
                What the file covers
                <select id="template-part" name="part" defaultValue="whole">
                  <option value="whole">
                    The whole workbook (sheets or headings name the tabs)
                  </option>
                  <option value="design">The design tab only</option>
                  <option value="interim">The interim testing tab only</option>
                  <option value="rollforward">The roll-forward tab only</option>
                </select>
              </label>
              <FilePicker
                name="content"
                accept=".docx,.xlsx,.xlsm"
                label="Workpaper template file"
                chooseLabel="Choose a file"
                submitLabel="Upload template"
              />
            </form>
          </div>
        </section>
      ) : null}
      {setup.preview !== null && previewControl !== null ? (
        <PreviewPanel
          model={model}
          preview={setup.preview}
          controls={included.filter(
            (control) => kindForDomain(control.domain) === setup.preview?.kind,
          )}
          current={previewControl}
          template={setup.template ?? ""}
        />
      ) : null}
    </>
  );
}

function TemplateRow({
  model,
  onboarding,
  template,
  kindOne,
  uses,
  total,
  sample,
  active,
  editable,
}: {
  model: Ready;
  onboarding: Onboarding;
  template: SetupTemplate;
  kindOne: string;
  uses: number;
  total: number;
  sample: SetupControl | undefined;
  active: boolean;
  editable: boolean;
}) {
  const firm = template.source === "FIRM";
  const used = uses > 0;
  const everywhere = total > 0 && uses === total;
  return (
    <li
      className={`template-row ${used ? "is-used" : ""} ${active ? "is-active" : ""}`}
    >
      <div className="template-row-main">
        <p className="template-row-title">
          <span>{template.title}</span>
          <span className={`pill ${firm ? "tone-info" : ""}`}>
            {firm ? "Your firm" : "Standard"}
          </span>
          {template.fileName !== "" ? (
            <span className="pill" title={template.fileName}>
              {template.fileName}
            </span>
          ) : null}
        </p>
        <p className="template-row-tabs">
          {template.tabs.map((tab) => (
            <span key={tab.key}>
              {tab.title} <b>{tab.sections.length}</b>
            </span>
          ))}
        </p>
        <p className="template-row-use">
          {total === 0
            ? "No controls of this kind are in scope yet."
            : everywhere
              ? `In use for every ${kindOne}.`
              : used
                ? `In use for ${uses} of ${total}.`
                : "Not in use."}
        </p>
      </div>
      <div className="template-row-side">
        {sample === undefined ? null : (
          <Link
            className="btn btn-secondary btn-sm"
            scroll={false}
            href={setupHref(model, "workpapers", {
              template: template.key,
              sample: sample.id,
            })}
          >
            Preview
          </Link>
        )}
        {editable ? (
          <div className="template-row-actions">
            {firm && !everywhere && total > 0 ? (
              <SetupForm className="sys-rec-actions">
                <TemplateFields
                  model={model}
                  onboarding={onboarding}
                  intent="workpaper-template-apply"
                  templateId={template.templateId}
                />
                <button type="submit" className="btn-sm">
                  Use for all
                </button>
              </SetupForm>
            ) : null}
            {firm ? (
              <a
                className="btn btn-secondary btn-sm"
                href={setupHref(model, "workpapers", {
                  edit: template.templateId,
                })}
              >
                Edit
              </a>
            ) : null}
            <SetupForm className="sys-rec-actions">
              <Identity
                model={model}
                onboarding={onboarding}
                intent="workpaper-template-customize"
                step="workpapers"
              />
              <input type="hidden" name="base_key" value={template.key} />
              <button type="submit" className="btn-ghost btn-sm">
                {firm ? "Copy" : "Customise"}
              </button>
            </SetupForm>
            {firm ? (
              <SetupForm className="sys-rec-actions">
                <TemplateFields
                  model={model}
                  onboarding={onboarding}
                  intent="workpaper-template-remove"
                  templateId={template.templateId}
                />
                <button type="submit" className="btn-ghost btn-sm">
                  Remove
                </button>
              </SetupForm>
            ) : null}
          </div>
        ) : null}
      </div>
    </li>
  );
}

/** The hidden fields a firm template action posts. */
function TemplateFields({
  model,
  onboarding,
  intent,
  templateId,
}: {
  model: Ready;
  onboarding: Onboarding;
  intent: string;
  templateId: string;
}) {
  return (
    <>
      <input
        type="hidden"
        name="organization_id"
        value={model.organization.id}
      />
      <input type="hidden" name="project_id" value={onboarding.projectId} />
      <input type="hidden" name="intent" value={intent} />
      <input type="hidden" name="step" value="workpapers" />
      <input type="hidden" name="template_id" value={templateId} />
    </>
  );
}

function PreviewPanel({
  model,
  preview,
  controls,
  current,
  template,
}: {
  model: Ready;
  preview: WorkpaperPreview;
  controls: readonly SetupControl[];
  current: SetupControl;
  template: string;
}) {
  return (
    <TemplatePreviewDialog
      title={preview.templateTitle}
      closeHref={setupHref(model, "workpapers")}
      current={current.id}
      choices={previewChoices(controls, (sample) =>
        setupHref(model, "workpapers", { template, sample }),
      )}
      panels={preview.tabs.map((tab, index) => ({
        key: tab.key,
        title: tab.title,
        reference: tab.reference,
        content: (
          <article className="workpaper">
            <header className="workpaper-head">
              <div className="workpaper-title">
                <p className="workpaper-eyebrow">
                  {preview.templateTitle}
                  <span aria-hidden="true"> · </span>
                  {tab.title}
                </p>
                <h3>{preview.title}</h3>
                <p className="workpaper-sub">
                  {model.selectedProject?.name ?? ""}
                </p>
              </div>
              <dl className="workpaper-ref">
                <dt>Workpaper</dt>
                <dd className="mono">{tab.reference}</dd>
                <dt>Template</dt>
                <dd>v{preview.templateVersion}</dd>
              </dl>
            </header>
            <div className="workpaper-body">
              {tab.sections.map((section) => (
                <WorkpaperSection key={section.title} section={section} />
              ))}
            </div>
            <footer className="workpaper-foot">
              <span>
                Preview with {current.controlRef}. Results are never filled in
                here.
              </span>
              <span>
                {index + 1} of {preview.tabs.length}
              </span>
            </footer>
          </article>
        ),
      }))}
    />
  );
}

function WorkpaperSection({ section }: { section: PreviewSection }) {
  let body: ReactNode = null;
  if (section.kind === "fields") {
    body = (
      <dl className="workpaper-fields">
        {uniqueKeys(section.fields, (field) => field.label).map(
          ([key, field]) => (
            <div key={key}>
              <dt>{field.label}</dt>
              <dd>{field.value}</dd>
            </div>
          ),
        )}
      </dl>
    );
  } else if (section.kind === "guidance") {
    body = <div className="workpaper-blank">{section.guidance}</div>;
  } else {
    body = (
      <>
        {section.guidance === "" ? null : (
          <p className="workpaper-guidance">{section.guidance}</p>
        )}
        <div className="table-wrap">
          <table className="workpaper-table">
            <thead>
              <tr>
                {section.columns.map((column) => (
                  <th key={column} scope="col">
                    {column}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {section.rows.map((row, rowIndex) => (
                <tr
                  key={`${section.title}-${row[0] ?? ""}-${rowIndex.toString()}`}
                >
                  {row.map((cell, cellIndex) => (
                    <td
                      key={`${section.columns[cellIndex] ?? cellIndex.toString()}`}
                    >
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </>
    );
  }
  return (
    <section
      className={`workpaper-section ${section.kind === "signoff" ? "is-signoff" : ""} ${section.kind === "fields" ? "is-fields" : ""}`}
    >
      <h4>
        <span>{section.title}</span>
      </h4>
      {body}
    </section>
  );
}

// Step 5
