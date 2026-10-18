"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import {
  CUE_STATUS_LABELS,
  HOSTING_LABELS,
  MAX_SOC_REPORT,
  type SetupSystem,
  SOC_STATUS_LABELS,
  type SocReport,
  wizardProblem,
} from "./onboarding-model";
import { UiIcon } from "./ui-icon";

type Ids = { organizationId: string; projectId: string };

const AVAILABILITY: Record<string, string> = {
  STATED_AVAILABLE: "The vendor states it issues a SOC 1 report.",
  NOT_FOUND: "No statement that the vendor issues a SOC 1 report was found.",
  NOT_RESEARCHED:
    "Whether the vendor issues a SOC 1 report was not researched.",
};

const OPINIONS: Record<string, string> = {
  UNQUALIFIED: "Unqualified opinion",
  QUALIFIED: "Qualified opinion",
  ADVERSE: "Adverse opinion",
  DISCLAIMER: "Disclaimer of opinion",
  UNKNOWN: "Opinion not found in the text",
};

/** The agent's SOC 1 assessment of a system: relevance, the vendor's statement, and why. */
export function SocAssessment({ system }: { system: SetupSystem }) {
  const assessment = system.assessment;
  if (assessment === null || assessment.socStatus === null) {
    return (
      <p className="form-hint">
        Not assessed yet. Use the magic wand on the controls to have the agent
        assess whether a SOC 1 report is relevant.
      </p>
    );
  }
  return (
    <div className="soc-assess">
      <p className="soc-assess-head">
        <span
          className={`pill pill-dot ${
            assessment.socStatus === "RELEVANT"
              ? "tone-info"
              : assessment.socStatus === "UNDETERMINED"
                ? "tone-warning"
                : "tone-neutral"
          }`}
        >
          {SOC_STATUS_LABELS[assessment.socStatus]}
        </span>
        {assessment.socProvider !== "" ? (
          <span className="soc-meta">{assessment.socProvider}</span>
        ) : null}
        {system.hosting !== null ? (
          <span className="soc-meta">
            {HOSTING_LABELS[system.hosting] ?? system.hosting} (assumed)
          </span>
        ) : null}
      </p>
      <p>{assessment.socBasis}</p>
      <p className="soc-meta">
        {AVAILABILITY[assessment.socAvailability]}
        {assessment.socSources.map((source) => (
          <span key={source.url}>
            {" "}
            <a href={source.url} target="_blank" rel="noreferrer noopener">
              {source.title || source.url}
            </a>
          </span>
        ))}
      </p>
    </div>
  );
}

/** Uploading a vendor's SOC report for the system: the agent reads it in the background. */
export function SocUpload({
  ids,
  system,
  editable,
}: {
  ids: Ids;
  system: SetupSystem;
  editable: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  if (!editable) {
    return null;
  }
  return (
    <div className="soc-upload">
      <label className="btn btn-secondary btn-sm soc-upload-button">
        <UiIcon name="upload" size={13} />
        {busy ? "Uploading…" : "Upload the SOC 1 report"}
        <input
          type="file"
          className="sr-only"
          accept=".pdf,.txt,application/pdf,text/plain"
          disabled={busy}
          onChange={async (event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file === undefined) {
              return;
            }
            if (file.size > MAX_SOC_REPORT) {
              setProblem(wizardProblem(413, "file is larger than 25 MB"));
              return;
            }
            setBusy(true);
            setProblem(null);
            const form = new FormData();
            form.set("organization_id", ids.organizationId);
            form.set("project_id", ids.projectId);
            form.set("system_id", system.id);
            form.set("content", file);
            let status = 0;
            let detail = "";
            try {
              const response = await fetch("/workspace/soc-upload", {
                method: "POST",
                body: form,
              });
              const body = (await response.json()) as {
                status?: unknown;
                detail?: unknown;
              };
              status = typeof body.status === "number" ? body.status : 0;
              detail = typeof body.detail === "string" ? body.detail : "";
            } catch {
              status = 0;
            }
            setBusy(false);
            const message = wizardProblem(status, detail);
            setProblem(message);
            if (message === null) {
              startTransition(() => router.refresh());
            }
          }}
        />
      </label>
      <span className="form-hint">
        PDF with text, up to 25 MB. The agent reads its facts and CUECs.
      </span>
      {problem !== null ? (
        <p className="cc-problem" role="alert">
          {problem}
        </p>
      ) : null}
    </div>
  );
}

/** The SOC reports uploaded for a system, and the CUECs read from each, with the page
 * their wording was found on and the controls they map to. */
export function SocReports({
  ids,
  reports,
  editable,
}: {
  ids: Ids;
  reports: SocReport[];
  editable: boolean;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  if (reports.length === 0) {
    return null;
  }
  return (
    <ul className="soc-reports-list">
      {reports.map((report) => (
        <li key={report.id} className="soc-report">
          <div className="soc-head">
            <strong>{report.fileName}</strong>
            <span className="soc-meta">
              {report.status === "READING"
                ? "Being read by the agent…"
                : report.status === "FAILED"
                  ? "Not read"
                  : [
                      report.serviceOrganization,
                      report.reportType
                        .replace("_", " ")
                        .replace("TYPE", "Type"),
                      report.periodStart !== null && report.periodEnd !== null
                        ? `${report.periodStart} to ${report.periodEnd}`
                        : "",
                      `${OPINIONS[report.opinion] ?? report.opinion}${
                        report.opinionPage !== null
                          ? ` (p. ${report.opinionPage})`
                          : ""
                      }`,
                    ]
                      .filter((part) => part !== "")
                      .join(" · ")}
            </span>
            {editable ? (
              <button
                type="button"
                className="btn-ghost btn-sm"
                onClick={async () => {
                  await fetch("/workspace/system-wizard", {
                    method: "POST",
                    headers: { "content-type": "application/json" },
                    body: JSON.stringify({
                      organization_id: ids.organizationId,
                      project_id: ids.projectId,
                      intent: "soc-remove",
                      report_id: report.id,
                    }),
                  });
                  startTransition(() => router.refresh());
                }}
              >
                Remove
              </button>
            ) : null}
          </div>
          {report.note !== "" ? (
            <p className="soc-meta">{report.note}</p>
          ) : null}
          {report.exceptions.length > 0 ? (
            <p className="soc-gap">
              {report.exceptions.length} exception
              {report.exceptions.length === 1 ? "" : "s"} noted by the service
              auditor
            </p>
          ) : null}
          {report.status === "READ" ? (
            report.cuecs.length === 0 ? (
              <p className="form-hint">
                No CUECs were found in the report's text.
              </p>
            ) : (
              <table className="soc-cuecs">
                <thead>
                  <tr>
                    <th scope="col">CUEC</th>
                    <th scope="col">Mapped controls</th>
                    <th scope="col">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {report.cuecs.map((cuec) => (
                    <tr key={cuec.id}>
                      <td>
                        <strong>{cuec.ref || "CUEC"}</strong> {cuec.text}
                        <small>
                          “{cuec.quote}”
                          {cuec.page !== null
                            ? ` · page ${cuec.page}`
                            : " · page not found"}
                        </small>
                      </td>
                      <td>
                        {cuec.controls.length === 0
                          ? "None"
                          : cuec.controls.map((control) => (
                              <span
                                key={control.controlRef}
                                className={`soc-control${control.inScope ? "" : " is-out"}`}
                                title={control.rationale}
                              >
                                {control.controlRef}
                                {control.inScope ? "" : " (not in scope)"}
                              </span>
                            ))}
                      </td>
                      <td>
                        <span
                          className={`soc-status is-${cuec.status.toLowerCase()}`}
                        >
                          {CUE_STATUS_LABELS[cuec.status]}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )
          ) : null}
        </li>
      ))}
    </ul>
  );
}
