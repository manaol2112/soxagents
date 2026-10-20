import {
  BUCKET_LABELS,
  BUCKET_NOTES,
  collapseRows,
  filterWords,
  groupQueue,
  ownerWords,
  type Queue,
  type QueueBucket,
  type QueueFilter,
  type QueueItem,
  queueHref,
  whereWords,
} from "./queue-model";
import { UiIcon } from "./ui-icon";

const STAGE_WORDS: Record<QueueItem["stage"], string> = {
  SETUP: "Set up",
  PLANS: "Test plans",
  EVIDENCE: "Evidence",
  TESTING: "Testing",
  REVIEW: "Review",
  CLOSE: "Close",
};

const PHASES = [
  ["INTERIM", "Interim"],
  ["DESIGN", "Design"],
  ["ROLLFORWARD", "Roll-forward"],
  ["RETEST", "Retest"],
] as const;

/**
 * The engagement's one queue of work, by responsibility: my actions, blocked, waiting on
 * others. Every row names the record it is about, the action, why, whose it is and
 * where it is done; a row never acts. Filters narrow by responsibility, stage and
 * phase; the API applied the same rules, so the client only groups.
 */
export function QueuePanel({
  queue,
  filter,
  organizationId,
  projectId,
  baseHref,
  compact = false,
}: {
  queue: Queue;
  filter: QueueFilter;
  organizationId: string;
  projectId: string;
  /** The page's own address, so a filter chip keeps the rest of the query. */
  baseHref: (filter: string) => string;
  /** The register's and console's shorter form: no filters, fewer rows. */
  compact?: boolean;
}) {
  const groups = groupQueue(queue, filter);
  const total = queue.items.length;
  const chip = (
    label: string,
    next: QueueFilter,
    active: boolean,
    count?: number,
  ) => (
    <a
      key={`${label}-${filterWords(next)}`}
      className={`queue-chip${active ? " is-active" : ""}`}
      href={baseHref(filterWords(next))}
      aria-current={active ? "true" : undefined}
    >
      {label}
      {count !== undefined ? (
        <span className="queue-chip-count">{count}</span>
      ) : null}
    </a>
  );
  return (
    <section
      className="card home-next"
      aria-labelledby="home-next-title"
      id="decision-queue"
    >
      <header className="card-header">
        <div>
          <h2 id="home-next-title">{compact ? "Needs attention" : "Work"}</h2>
          <p className="card-desc">
            {compact
              ? "The engagement's one queue, for these controls."
              : "Everything open on the engagement, by whose it is. One list: the register, the agent console and this page read the same records."}
          </p>
        </div>
        <div className="card-aside">
          <span
            className="count"
            role="status"
            aria-label={`${queue.counts.MINE} of ${total} yours`}
          >
            {queue.counts.MINE} yours · {total} open
          </span>
        </div>
      </header>
      {compact ? null : (
        <nav className="queue-filters" aria-label="Filter the queue">
          <div className="queue-filter-row">
            {chip(
              "All",
              { ...filter, bucket: null },
              filter.bucket === null,
              total,
            )}
            {(["MINE", "BLOCKED", "WAITING", "UPCOMING"] as const).map(
              (bucket) =>
                chip(
                  BUCKET_LABELS[bucket],
                  { ...filter, bucket },
                  filter.bucket === bucket,
                  queue.counts[bucket],
                ),
            )}
          </div>
          <div className="queue-filter-row">
            {chip(
              "Every stage",
              { ...filter, stage: null },
              filter.stage === null,
            )}
            {(Object.keys(STAGE_WORDS) as QueueItem["stage"][])
              .filter((stage) =>
                queue.items.some((item) => item.stage === stage),
              )
              .map((stage) =>
                chip(
                  STAGE_WORDS[stage],
                  { ...filter, stage },
                  filter.stage === stage,
                ),
              )}
          </div>
          <div className="queue-filter-row">
            {chip(
              "Every phase",
              { ...filter, phase: null },
              filter.phase === null,
            )}
            {PHASES.filter(([key]) =>
              queue.items.some((item) => item.phase === key),
            ).map(([key, label]) =>
              chip(label, { ...filter, phase: key }, filter.phase === key),
            )}
          </div>
        </nav>
      )}
      {groups.length === 0 ? (
        <div className="queue-clear">
          <span className="queue-clear-icon" aria-hidden="true">
            <UiIcon name="check" size={14} />
          </span>
          <p>
            <strong>
              {total === 0
                ? "Nothing is open on the engagement."
                : "Nothing matches these filters."}
            </strong>
          </p>
        </div>
      ) : (
        groups.map((group) => (
          <div
            key={group.bucket}
            className={`home-group queue-${group.bucket.toLowerCase()}`}
          >
            <h3 className="home-group-title">
              {BUCKET_LABELS[group.bucket]}
              <span className="home-group-current">{group.items.length}</span>
            </h3>
            {compact ? null : (
              <p className="queue-note">{BUCKET_NOTES[group.bucket]}</p>
            )}
            <ul className="home-steps">
              {collapseRows(
                compact ? group.items.slice(0, 8) : group.items,
              ).map((row, index) =>
                row.kind === "item" ? (
                  <QueueRow
                    key={row.item.id}
                    item={row.item}
                    lead={!compact && group.bucket === "MINE" && index === 0}
                    href={queueHref(row.item, organizationId, projectId)}
                  />
                ) : (
                  <li
                    key={`group-${row.title}`}
                    className="home-step queue-group"
                  >
                    <details>
                      <summary className="home-step-copy">
                        <strong>
                          {row.title}
                          <span className="home-step-ref">
                            {" "}
                            {row.items.length} controls
                          </span>
                        </strong>
                        <small>
                          {ownerWords(row.items[0] as QueueItem)}. Open for the
                          list.
                        </small>
                      </summary>
                      <ul className="home-steps queue-group-items">
                        {row.items.map((item) => (
                          <li key={item.id} className="home-step">
                            <span className="home-step-copy">
                              <strong>
                                <span className="home-step-ref">
                                  {item.controlRef ?? ""}
                                </span>
                                {item.title}
                              </strong>
                            </span>
                            <a
                              className="btn btn-sm btn-secondary"
                              href={queueHref(item, organizationId, projectId)}
                            >
                              {item.bucket === "MINE" ? "Open" : "View"}
                              <UiIcon name="arrow" size={13} />
                            </a>
                          </li>
                        ))}
                      </ul>
                    </details>
                  </li>
                ),
              )}
            </ul>
          </div>
        ))
      )}
    </section>
  );
}

function QueueRow({
  item,
  lead,
  href,
}: {
  item: QueueItem;
  lead: boolean;
  href: string;
}) {
  const where = whereWords(item);
  return (
    <li
      className={`home-step${lead ? " is-lead" : ""}${item.blocks ? " is-blocking" : ""}`}
    >
      <span className="home-step-copy">
        {lead ? <span className="home-step-start">Start here</span> : null}
        <strong>
          {where !== "" ? <span className="home-step-ref">{where}</span> : null}
          {item.title}
        </strong>
        <small>
          {item.reason !== "" ? `${item.reason} ` : ""}
          <span className="queue-owner">{ownerWords(item)}.</span>
          {item.blockers.length > 0 ? (
            <span className="queue-blockers">
              {" "}
              Held by: {item.blockers.join("; ")}.
            </span>
          ) : null}
        </small>
      </span>
      <a
        className={`btn btn-sm${lead ? "" : " btn-secondary"}`}
        href={href}
        aria-label={`${item.bucket === "MINE" ? "Open" : "View"}: ${item.title}`}
      >
        {item.bucket === "MINE" ? "Open" : "View"}
        <UiIcon name="arrow" size={13} />
      </a>
    </li>
  );
}

/** The bucket a viewer filters to first: theirs when any, else everything. */
export function defaultBucket(queue: Queue): QueueBucket | null {
  return queue.counts.MINE > 0 ? null : null;
}
