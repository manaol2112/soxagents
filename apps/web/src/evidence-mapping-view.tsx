import {
  type EvidenceMappingRun,
  MAPPING_STATUS_LABELS,
  MAPPING_STATUS_TONES,
  mappingSummary,
} from "./evidence-mapping-model";
import { formatDate } from "./format";

/**
 * The evidence-to-attribute mapping on the control's Test step (Milestone 3b): for each
 * approved attribute, what the evidence on hand shows, as passages the API verified and
 * located, with what is missing and what conflicts. A proposal for the tester, never a
 * conclusion; a person maps evidence again after the files or the plan change.
 */
export function EvidenceMappingPanel({
  run,
  ids,
  back,
  canMap,
}: {
  run: EvidenceMappingRun | null;
  ids: { organizationId: string; projectId: string; controlId: string };
  back: string;
  canMap: boolean;
}) {
  return (
    <section className="cw-mapping" aria-labelledby="cw-mapping-title">
      <header className="cw-mapping-head">
        <div>
          <h3 id="cw-mapping-title">Evidence mapping</h3>
          <p>
            {run === null
              ? "Not mapped yet. Mapping reads the approved attributes at the plan's current revision and names, for each, the passages of the evidence on hand that bear on it."
              : `${mappingSummary(run)} · mapped ${formatDate(run.createdAt)} by ${run.requestedBy} at plan revision ${run.planRevision}`}
          </p>
          {run?.stale === true ? (
            <p className="cw-mapping-stale" role="status">
              Out of date: {run.staleReasons.join(" ")} Map the evidence again.
            </p>
          ) : null}
        </div>
        {canMap ? (
          <form
            method="post"
            action="/workspace/evidence-mapping"
            autoComplete="off"
          >
            <input
              type="hidden"
              name="organization_id"
              value={ids.organizationId}
            />
            <input type="hidden" name="project_id" value={ids.projectId} />
            <input type="hidden" name="control_id" value={ids.controlId} />
            <input type="hidden" name="back" value={back} />
            <button type="submit" className="btn btn-secondary btn-sm">
              {run === null ? "Map evidence" : "Map again"}
            </button>
          </form>
        ) : null}
      </header>
      {run !== null ? (
        <ol className="cw-mapping-list">
          {run.mappings.map((mapping) => (
            <li
              key={mapping.index}
              className={`is-${MAPPING_STATUS_TONES[mapping.status]}`}
            >
              <div className="cw-mapping-row">
                <span
                  className={`cw-mapping-status is-${MAPPING_STATUS_TONES[mapping.status]}`}
                >
                  {MAPPING_STATUS_LABELS[mapping.status]}
                </span>
                <span className="cw-mapping-attribute">
                  <strong>A{mapping.index + 1}</strong> {mapping.attribute}
                </span>
              </div>
              {mapping.references.length > 0 ? (
                <ul className="cw-mapping-refs">
                  {mapping.references.map((reference) => (
                    <li
                      key={`${reference.fileId}-${reference.location}-${reference.quote}`}
                    >
                      <span className="cw-mapping-ref-where">
                        {reference.fileName}
                        {reference.location !== ""
                          ? ` · ${reference.location}`
                          : ""}
                      </span>
                      <q>{reference.quote}</q>
                    </li>
                  ))}
                </ul>
              ) : null}
              {mapping.conflicts.length > 0 ? (
                <p className="cw-mapping-conflicts">
                  <strong>Conflicts:</strong>{" "}
                  {mapping.conflicts.map((c) => c.text).join(" ")}
                </p>
              ) : null}
              {mapping.missing.length > 0 ? (
                <p className="cw-mapping-missing">
                  <strong>Missing:</strong> {mapping.missing.join(" ")}
                </p>
              ) : null}
              {mapping.inferences.length > 0 ? (
                <details className="cw-mapping-more">
                  <summary>
                    {mapping.inferences.length} inference(s), not facts
                  </summary>
                  <ul>
                    {mapping.inferences.map((item) => (
                      <li key={`${mapping.index}-${item}`}>{item}</li>
                    ))}
                  </ul>
                </details>
              ) : null}
              {mapping.note !== "" ? <small>{mapping.note}</small> : null}
            </li>
          ))}
        </ol>
      ) : null}
    </section>
  );
}
