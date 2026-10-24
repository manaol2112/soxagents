import {
  clearable,
  groupAction,
  holdCounts,
  holdsOf,
  homeWork,
  whoseSummary,
} from "./home-work-model";
import {
  collapseRows,
  groupCount,
  linkHref,
  ownerWords,
  type Queue,
  type QueueItem,
  queueHref,
  whereWords,
} from "./queue-model";
import { UiIcon } from "./ui-icon";

/** How many rows Needs you shows before "Show all". */
const NEEDS_YOU_ROWS = 5;

/**
 * Home's work (docs/home-plan.md): what needs the viewer first, the first of it marked,
 * then the rest of what is open folded by whose turn it is. Every row opens the record
 * where it is done; nothing here acts. The full list, with filters, is one link away.
 */
export function HomeWorkPanel({
  queue,
  organizationId,
  projectId,
  allHref,
  idle,
}: {
  queue: Queue;
  organizationId: string;
  projectId: string;
  /** The full list of open work, with its filters. */
  allHref: string;
  /** What comes next on the engagement, said when nothing needs the viewer. */
  idle: string;
}) {
  const work = homeWork(queue);
  const rows = collapseRows(work.needsYou);
  const shown = rows.slice(0, NEEDS_YOU_ROWS);
  const href = (item: QueueItem) => queueHref(item, organizationId, projectId);
  const fixHref = (link: { section: string; query: Record<string, string> }) =>
    linkHref(link, organizationId, projectId);
  const others =
    work.blocked.length + work.waiting.length + work.upcoming.length;
  return (
    <>
      <section
        className="card home-needs"
        aria-labelledby="home-needs-title"
        id="decision-queue"
      >
        <header className="card-header">
          <div>
            <h2 id="home-needs-title">Needs you</h2>
            <p className="card-desc">
              Yours to act on, the most pressing first.
            </p>
          </div>
          <span className="count" role="status">
            {work.needsYou.length}
          </span>
        </header>
        {shown.length === 0 ? (
          <div className="queue-clear">
            <span className="queue-clear-icon" aria-hidden="true">
              <UiIcon name="check" size={14} />
            </span>
            <p>
              <strong>Nothing needs you now.</strong> {idle}
            </p>
          </div>
        ) : (
          <ul className="home-steps">
            {shown.map((row, index) =>
              row.kind === "item" ? (
                <NeedsRow
                  key={row.item.id}
                  item={row.item}
                  lead={index === 0}
                  href={href(row.item)}
                  fixHref={fixHref}
                />
              ) : (
                <GroupRow
                  key={`group-${row.title}`}
                  title={row.title}
                  items={row.items}
                  lead={index === 0}
                  href={href}
                  fixHref={fixHref}
                  action={groupAction(row.items, organizationId, projectId)}
                />
              ),
            )}
          </ul>
        )}
        {rows.length > shown.length ? (
          <footer className="home-more">
            <a className="text-link" href={allHref}>
              Show all {work.needsYou.length} that need you
            </a>
          </footer>
        ) : null}
      </section>
      <section className="card home-others" aria-labelledby="home-others-title">
        <header className="card-header">
          <div>
            <h2 id="home-others-title">Other open work</h2>
            <p className="card-desc">
              {others === 0
                ? "Nothing else is open on the engagement."
                : "Held, with someone else, or not due yet."}
            </p>
          </div>
          <a className="text-link" href={allHref}>
            All work and filters
          </a>
        </header>
        <Fold
          title="Blocked"
          items={work.blocked}
          summary="Held until something else happens; what holds each is shown on it."
          open={work.needsYou.length === 0}
          href={href}
        />
        <Fold
          title="Waiting on others"
          items={work.waiting}
          summary={whoseSummary(work.waiting)}
          open={false}
          href={href}
        />
        <Fold
          title="Upcoming"
          items={work.upcoming}
          summary="Not due yet: a phase not released, a window not reached, or agent work waiting to start."
          open={false}
          href={href}
        />
      </section>
    </>
  );
}

type LinkHref = (link: {
  section: string;
  query: Record<string, string>;
}) => string;

/** What holds an item in the rest of the work: its own words, or, for a system
 * condition, a pointer to the notice at the top that explains it once. */
function holdWords(item: QueueItem): string {
  const holds = holdsOf(item);
  if (holds.length === 0) {
    return "";
  }
  if (holds.every((hold) => hold.system)) {
    return "Held by a condition described at the top of the page.";
  }
  return `Held by: ${holds
    .filter((hold) => !hold.system)
    .map((hold) => hold.text.replace(/\.$/, ""))
    .join("; ")}.`;
}

/** What holds every item of a group, when it is the same for all of them. */
function sharedHold(items: QueueItem[]): string {
  const words = new Set(items.map(holdWords));
  return words.size === 1 ? ([...words][0] ?? "") : "";
}

function NeedsRow({
  item,
  lead,
  href,
  fixHref,
}: {
  item: QueueItem;
  lead: boolean;
  href: string;
  fixHref: LinkHref;
}) {
  const where = whereWords(item);
  // A hold the viewer clears: its words, and its fix as the row's action.
  const cause = clearable(item)
    ? holdsOf(item).find((entry) => !entry.system)
    : undefined;
  const hold = cause?.text ?? "";
  const target =
    cause !== undefined && cause.fix !== null ? fixHref(cause.fix) : href;
  return (
    <li className={`home-step${lead ? " is-lead" : ""}`}>
      <span className="home-step-copy">
        {lead ? <span className="home-step-start">Start here</span> : null}
        <strong>
          {where !== "" ? <span className="home-step-ref">{where}</span> : null}
          {item.title}
        </strong>
        <small>
          {hold !== "" ? (
            <span className="home-step-hold">First: {hold}</span>
          ) : (
            item.reason
          )}
        </small>
      </span>
      <a
        className={`btn btn-sm${lead ? "" : " btn-secondary"}`}
        href={target}
        aria-label={`${hold !== "" ? "Resolve" : "Open"}: ${item.title}`}
      >
        {hold !== "" ? "Resolve" : "Open"}
        <UiIcon name="arrow" size={13} />
      </a>
    </li>
  );
}

/**
 * The items of a step repeated across controls. Each is named by its control instance
 * and phase; the step is the group's title, so it is not repeated on every row.
 */
export function GroupItems({
  items,
  href,
  verb,
}: {
  items: readonly QueueItem[];
  href: (item: QueueItem) => string;
  verb: (item: QueueItem) => string;
}) {
  return (
    <ul className="home-steps queue-group-items">
      {items.map((item) => (
        <li key={item.id} className="home-step">
          <span className="home-step-copy">
            <strong>{whereWords(item) || item.title}</strong>
          </span>
          <a
            className="btn btn-sm btn-secondary"
            href={href(item)}
            aria-label={`${verb(item)}: ${item.title}, ${whereWords(item)}`}
          >
            {verb(item)}
            <UiIcon name="arrow" size={13} />
          </a>
        </li>
      ))}
    </ul>
  );
}

/** How a group's list is shown: a plain affordance whose chevron turns when open. */
export function GroupToggle({ items }: { items: readonly QueueItem[] }) {
  return (
    <span className="queue-group-toggle">
      Show the {groupCount(items)}
      <UiIcon name="chevron" size={12} />
    </span>
  );
}

/** A step repeated across many controls: one row with its count, the list folded under
 * it, and where it is done for all of them together when a page does that. */
function GroupRow({
  title,
  items,
  lead,
  href,
  fixHref,
  action,
}: {
  title: string;
  items: QueueItem[];
  lead: boolean;
  href: (item: QueueItem) => string;
  fixHref: LinkHref;
  action: { label: string; href: string } | null;
}) {
  const first = items[0] as QueueItem;
  // The causes behind the rows, each with how many it holds and where it is cleared.
  const causes = holdCounts(items.filter(clearable)).filter(
    (cause) => !cause.system,
  );
  return (
    <li
      className={`home-step queue-group${lead ? " is-lead" : ""}${action !== null ? " has-action" : ""}`}
    >
      <details>
        <summary className="home-step-copy">
          {lead ? <span className="home-step-start">Start here</span> : null}
          <strong>
            {title}
            <span className="home-step-ref"> {groupCount(items)}</span>
          </strong>
          {causes.length > 0 ? (
            <small>
              Held by{" "}
              {causes.length === 1 ? "one cause" : `${causes.length} causes`},
              below.
            </small>
          ) : first.reason !== "" ? (
            <small>{first.reason}</small>
          ) : null}
          <GroupToggle items={items} />
        </summary>
        <GroupItems items={items} href={href} verb={() => "Open"} />
      </details>
      {action !== null ? (
        <a
          className={`btn btn-sm queue-group-action${lead ? "" : " btn-secondary"}`}
          href={action.href}
        >
          {action.label}
          <UiIcon name="arrow" size={13} />
        </a>
      ) : null}
      {causes.length > 0 ? (
        <ul className="home-causes">
          {causes.slice(0, 4).map((cause) => (
            <li key={cause.hold}>
              <span className="home-step-hold">
                {cause.hold.replace(/\.$/, "")}
                <span className="home-cause-count">
                  {" "}
                  · {cause.count} {cause.count === 1 ? "item" : "items"}
                </span>
              </span>
              {cause.fix !== null ? (
                <a className="text-link" href={fixHref(cause.fix)}>
                  Resolve
                </a>
              ) : null}
            </li>
          ))}
          {causes.length > 4 ? (
            <li className="form-hint">
              And {causes.length - 4} more; open the list for each.
            </li>
          ) : null}
        </ul>
      ) : null}
    </li>
  );
}

/** One bucket of the rest of the work, folded to its count and a one-line summary. */
function Fold({
  title,
  items,
  summary,
  open,
  href,
}: {
  title: string;
  items: QueueItem[];
  summary: string;
  open: boolean;
  href: (item: QueueItem) => string;
}) {
  if (items.length === 0) {
    return null;
  }
  return (
    <details className="home-fold" open={open}>
      <summary>
        <span className="home-fold-title">
          {title} <span className="home-group-current">{items.length}</span>
        </span>
        <span className="home-fold-summary">{summary}</span>
      </summary>
      <ul className="home-steps">
        {collapseRows(items).map((row) =>
          row.kind === "item" ? (
            <li key={row.item.id} className="home-step">
              <span className="home-step-copy">
                <strong>
                  {whereWords(row.item) !== "" ? (
                    <span className="home-step-ref">
                      {whereWords(row.item)}
                    </span>
                  ) : null}
                  {row.item.title}
                </strong>
                <small>
                  {ownerWords(row.item)}.
                  {holdWords(row.item) !== "" ? ` ${holdWords(row.item)}` : ""}
                </small>
              </span>
              <a
                className="btn btn-sm btn-secondary"
                href={href(row.item)}
                aria-label={`View: ${row.item.title}`}
              >
                View
                <UiIcon name="arrow" size={13} />
              </a>
            </li>
          ) : (
            <li key={`group-${row.title}`} className="home-step queue-group">
              <details>
                <summary className="home-step-copy">
                  <strong>
                    {row.title}
                    <span className="home-step-ref">
                      {" "}
                      {groupCount(row.items)}
                    </span>
                  </strong>
                  <small>
                    {ownerWords(row.items[0] as QueueItem)}.
                    {sharedHold(row.items) !== ""
                      ? ` ${sharedHold(row.items)}`
                      : ""}
                  </small>
                  <GroupToggle items={row.items} />
                </summary>
                <GroupItems items={row.items} href={href} verb={() => "View"} />
              </details>
            </li>
          ),
        )}
      </ul>
    </details>
  );
}
