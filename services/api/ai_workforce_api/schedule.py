"""The standard SOX calendar for an engagement. Pure date arithmetic, no database.

A SOX engagement tests the controls over the fiscal year ending on the period end.
The calendar follows how audit teams run one: plan and scope, walk through each
control, collect evidence, test operating effectiveness at an interim date (usually
the end of the third quarter), retest remediated controls before year end, roll the
interim testing forward to the period end, then evaluate deficiencies and sign off.

When kickoff is too close to the interim date for interim testing, or the period has
already ended, the calendar compresses: every phase starts on or after kickoff and
keeps its order.
"""

from dataclasses import dataclass
from datetime import date, timedelta

PHASES: tuple[tuple[str, str], ...] = (
    ("PLANNING", "Planning and scoping"),
    ("WALKTHROUGHS", "Walkthroughs and design"),
    ("EVIDENCE", "Evidence collection"),
    ("INTERIM_TESTING", "Interim testing"),
    ("REMEDIATION", "Remediation retesting"),
    ("ROLLFORWARD", "Roll-forward and year-end testing"),
    ("REPORTING", "Deficiency evaluation and reporting"),
)
PHASE_NAMES = dict(PHASES)
PHASE_KEYS = tuple(key for key, _name in PHASES)

# Which phase each kind of kickoff task belongs to.
KIND_PHASES = {
    "walkthrough": "WALKTHROUGHS",
    "evidence": "EVIDENCE",
    "test": "INTERIM_TESTING",
    "review": "INTERIM_TESTING",
    "report": "REPORTING",
}


@dataclass(frozen=True)
class Phase:
    key: str
    name: str
    position: int
    start: date
    end: date


@dataclass(frozen=True)
class Milestone:
    key: str
    name: str
    phase_key: str
    position: int
    due: date


@dataclass(frozen=True)
class Schedule:
    phases: tuple[Phase, ...]
    milestones: tuple[Milestone, ...]
    interim: bool

    def phase(self, key: str) -> Phase:
        return next(phase for phase in self.phases if phase.key == key)


def month_end(year: int, month: int) -> date:
    first_next = date(year + month // 12, month % 12 + 1, 1)
    return first_next - timedelta(days=1)


def interim_cutoff(period_end: date) -> date:
    """The end of the month three months before the period end (Sep 30 for Dec 31)."""
    month = period_end.month - 3
    year = period_end.year
    if month <= 0:
        month += 12
        year -= 1
    return month_end(year, month)


def standard_schedule(kickoff: date, period_end: date, pbc_due_days: int) -> Schedule:
    day = timedelta(days=1)
    cutoff = interim_cutoff(period_end)
    # Interim testing needs about six weeks of runway before the interim date.
    interim = kickoff + 42 * day <= cutoff
    planning = (kickoff, kickoff + 13 * day)
    walkthroughs = (kickoff + 7 * day, kickoff + 41 * day)
    if interim:
        testing = (max(kickoff + 28 * day, cutoff - 45 * day), cutoff + 45 * day)
        remediation = (testing[1] - 14 * day, period_end + 15 * day)
    else:
        testing = (kickoff + 28 * day, kickoff + 75 * day)
        remediation = (kickoff + 60 * day, max(period_end, kickoff + 75 * day) + 30 * day)
    evidence = (kickoff, max(testing[1], kickoff + (pbc_due_days + 14) * day))
    rollforward = (period_end + day, period_end + 40 * day)
    reporting = (period_end + 30 * day, period_end + 60 * day)
    ranges = {
        "PLANNING": planning,
        "WALKTHROUGHS": walkthroughs,
        "EVIDENCE": evidence,
        "INTERIM_TESTING": testing,
        "REMEDIATION": remediation,
        "ROLLFORWARD": rollforward,
        "REPORTING": reporting,
    }
    # A period that has already ended: every phase still starts at or after kickoff,
    # and the year-end phases follow testing instead of the period end.
    if rollforward[0] < testing[1]:
        rollforward = (testing[0] + 14 * day, testing[1] + 21 * day)
        reporting = (rollforward[1] - 7 * day, rollforward[1] + 28 * day)
        remediation = (testing[0] + 21 * day, rollforward[1])
        ranges.update(ROLLFORWARD=rollforward, REPORTING=reporting, REMEDIATION=remediation)
    phases = tuple(
        Phase(key, name, index + 1, *_after(ranges[key], kickoff))
        for index, (key, name) in enumerate(PHASES)
    )
    by_key = {phase.key: phase for phase in phases}
    marks: list[tuple[str, str, str, date]] = [
        ("KICKOFF", "Kickoff", "PLANNING", kickoff),
        (
            "SCOPING_COMPLETE",
            "Scoping and risk assessment complete",
            "PLANNING",
            by_key["PLANNING"].end,
        ),
        ("PBC_DUE", "First evidence requests due", "EVIDENCE", kickoff + pbc_due_days * day),
        (
            "WALKTHROUGHS_COMPLETE",
            "Walkthroughs complete",
            "WALKTHROUGHS",
            by_key["WALKTHROUGHS"].end,
        ),
    ]
    if interim:
        marks.append(("INTERIM_CUTOFF", "Interim testing date", "INTERIM_TESTING", cutoff))
    marks.extend(
        [
            (
                "INTERIM_TESTING_COMPLETE",
                "Interim testing complete",
                "INTERIM_TESTING",
                by_key["INTERIM_TESTING"].end,
            ),
            (
                "REVIEW_COMPLETE",
                "Independent review complete",
                "INTERIM_TESTING",
                by_key["INTERIM_TESTING"].end + 14 * day,
            ),
            (
                "REMEDIATION_CUTOFF",
                "Remediation cut-off",
                "REMEDIATION",
                max(period_end - 30 * day, by_key["REMEDIATION"].start),
            ),
            ("PERIOD_END", "Period end", "ROLLFORWARD", period_end),
            (
                "ROLLFORWARD_COMPLETE",
                "Roll-forward complete",
                "ROLLFORWARD",
                by_key["ROLLFORWARD"].end,
            ),
            (
                "DEFICIENCY_EVALUATION",
                "Deficiency evaluation complete",
                "REPORTING",
                max(by_key["REPORTING"].start, by_key["REPORTING"].end - 15 * day),
            ),
            (
                "SIGN_OFF",
                "Management assessment and sign-off",
                "REPORTING",
                by_key["REPORTING"].end,
            ),
        ]
    )
    milestones = tuple(
        Milestone(key, name, phase, index + 1, due)
        for index, (key, name, phase, due) in enumerate(sorted(marks, key=lambda m: m[3]))
    )
    return Schedule(phases=phases, milestones=milestones, interim=interim)


def _after(span: tuple[date, date], kickoff: date) -> tuple[date, date]:
    start = max(span[0], kickoff)
    return start, max(span[1], start)
