import { GroupItems, GroupToggle } from "./home-work";
import { clearable, groupAction } from "./home-work-model";
import {
  BUCKET_LABELS,
  BUCKET_NOTES,
  collapseRows,
  filterWords,
  groupCount,
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
          <h2 id="home-next-title">
            {compact ? "Needs attention" : "All open work"}
          </h2>
          <p className="card-desc">
            {compact
              ? "What is open on these controls."
              : "What is open on this engagement, by whose turn it is."}
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
        <nav className="queue-filters" aria-label="Filter the work">
          <div className="queue-filter-row queue-segmented">
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
          <details
            className="queue-more-filters"
            open={filter.stage !== null || filter.phase !== null}
          >
            <summary>Filter by stage or phase</summary>
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
          </details>
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
              <p className="queue-note">
                {BUCKET_NOTES[group.bucket]}
                {group.bucket === "BLOCKED" && group.items.some(clearable)
                  ? ` ${group.items.filter(clearable).length} of these you can clear yourself; Home lists them under Needs you.`
                  : ""}
              </p>
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
                  <QueueGroup
                    key={`group-${row.title}`}
                    title={row.title}
                    items={row.items}
                    organizationId={organizationId}
                    projectId={projectId}
                  />
                ),
              )}
            </ul>
          </div>
        ))
      )}
    </section>
  );
}

/** A step repeated across controls: its count, the list folded under it, and where it is
 * done for all of them together when the viewer has it to do and a page does that. */
function QueueGroup({
  title,
  items,
  organizationId,
  projectId,
}: {
  title: string;
  items: QueueItem[];
  organizationId: string;
  projectId: string;
}) {
  const action = items.some((item) => item.bucket === "MINE")
    ? groupAction(items, organizationId, projectId)
    : null;
  return (
    <li
      className={`home-step queue-group${action !== null ? " has-action" : ""}`}
    >
      <details>
        <summary className="home-step-copy">
          <strong>
            {title}
            <span className="home-step-ref"> {groupCount(items)}</span>
          </strong>
          {/* Whose it is, except the viewer's own (the section says so). */}
          {(items[0] as QueueItem).bucket === "MINE" ? null : (
            <small>{ownerWords(items[0] as QueueItem)}.</small>
          )}
          <GroupToggle items={items} />
        </summary>
        <GroupItems
          items={items}
          href={(item) => queueHref(item, organizationId, projectId)}
          verb={(item) => (item.bucket === "MINE" ? "Open" : "View")}
        />
      </details>
      {action !== null ? (
        <a
          className="btn btn-sm btn-secondary queue-group-action"
          href={action.href}
        >
          {action.label}
          <UiIcon name="arrow" size={13} />
        </a>
      ) : null}
    </li>
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
          {item.bucket === "MINE" ? null : (
            <span className="queue-owner">{ownerWords(item)}.</span>
          )}
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
