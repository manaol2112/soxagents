"""The Northstar audit lifecycle (Step 4B): planning, evidence, testing, review and
deficiencies on the launched demo engagement, through the application's own services.

Every decision a person makes in the product is made here by the demo's own people
(demo_northstar.dataset.TEAM_ROLES) through the same functions the routes call, with the
same checks: Dana Whitfield (lead) approves plans and logs deficiencies, Morgan Lee
(tester) files evidence, signs test sheets and prepares workpapers, Riley Okafor
(independent reviewer) raises and clears notes and signs reviews. Nothing of the audit's
rules is bypassed: readiness, the population gate, sheet conclusions, independence.

What the dataset prepares rather than a model (criteria, request drafts, test results,
workpaper content, re-performance) says so with SEEDED provenance. Every test result cites
the words of the evidence file it rests on, verified against the file's extracted text
with the same check the tester's own results go through; a result the files do not
support is never written.

The scenario clock is FY2027 (interim as of 30 September 2027): the records, criteria and
conclusions speak of that period. The workflow's own timestamps are the moment the demo
was prepared, which the labels say. Nothing here reads or sets the system clock, and the
rules that compare a date with today (remediation ready-for-retest, retest readiness) are
left to the real clock: the two remediation scenarios run to the point those rules allow.
"""

# ruff: noqa: E501  (the results and criteria read as sentences)
from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import date
from decimal import Decimal
from typing import Any
from uuid import UUID, uuid5

import psycopg
from psycopg.types.json import Json

from ai_workforce_api.authorization import Principal, PrincipalKind
from ai_workforce_api.demo_northstar import files as F
from ai_workforce_api.demo_northstar import plans as P
from ai_workforce_api.demo_northstar import records as R

logger = logging.getLogger(__name__)

SEEDED = "SEEDED"
PREPARED_NOTE = P.WORKPAPER_NOTE
NAMESPACE = UUID("8a4d0f2e-5b61-4c7a-9e0d-3f2b1c6d7e88")

# The population file of each sampled control, and the keys its sample must contain so
# the scenario is in the tester's hands (the seed is searched until it is).
POPULATIONS: dict[str, tuple[str, tuple[str, ...]]] = {
    "NS-AC-01": ("access_requests", ()),
    "NS-AC-02": ("hr_terminations", (R.LATE_TERMINATION_EMPLOYEE, R.OPEN_TERMINATION_EMPLOYEE)),
    "NS-AC-03": ("privileged_access", (R.UNAPPROVED_PRIVILEGED_USER,)),
    "NS-AC-04": ("access_certifications", ("AR-2027-Q3",)),
    "NS-AC-05": ("entra_pim", ()),
    "NS-AC-07": ("snowflake_grants", ("GR-001", "GR-003")),
    "NS-CM-01": ("transport_log", (R.UNAPPROVED_TRANSPORT, R.LATE_APPROVED_TRANSPORT)),
    "NS-CM-02": ("pipeline_prs", ()),
    "NS-OP-01": ("batch_monitoring", ()),
    "NS-OP-02": ("task_history", ("TR-0914-01",)),
    "NS-IP-01": ("close_calendar", ("2027-08", "2027-09")),
    "NS-MR-01": ("close_calendar", ("2027-08", "2027-09")),
}
# Controls whose deficiency goes through remediation (the two scenarios).
REMEDIATED: tuple[str, ...] = ("NS-AC-02", "NS-CM-01")
# Reviews signed by the reviewer; the rest wait as pending review.
REVIEW_SIGNED: tuple[str, ...] = (
    "NS-AC-01", "NS-AC-02", "NS-AC-04", "NS-AC-05", "NS-CM-01", "NS-CM-02", "NS-OP-01",
    "NS-AP-01", "NS-IP-01", "NS-MR-01",
)  # fmt: skip
DEFICIENCY_SEVERITY: dict[str, str] = {
    "NS-AC-02": "SIGNIFICANT_DEFICIENCY",
    "NS-AC-03": "SIGNIFICANT_DEFICIENCY",
    "NS-CM-01": "SIGNIFICANT_DEFICIENCY",
    "NS-OP-02": "CONTROL_DEFICIENCY",
    "NS-IP-01": "CONTROL_DEFICIENCY",
    "NS-MR-01": "CONTROL_DEFICIENCY",
}


@dataclass
class Context:
    connection: psycopg.Connection[Any]
    cursor: psycopg.Cursor[Any]
    organization_id: UUID
    project_id: UUID
    team: dict[str, UUID]
    controls: dict[str, UUID]
    systems: dict[str, UUID]
    filed: dict[tuple[str, str], UUID]
    data: R.Records
    evidence: dict[str, F.EvidenceFile]
    texts: dict[str, str]
    summary: dict[str, Any]
    settings: Any = None

    def principal(self, who: str) -> Principal:
        return Principal(PrincipalKind.USER, self.team[who])

    def file_id(self, key: str, control_ref: str) -> UUID:
        return self.filed[(key, control_ref)]


def run_lifecycle(
    connection: psycopg.Connection[Any],
    cursor: psycopg.Cursor[Any],
    organization_id: UUID,
    project_id: UUID,
    team: dict[str, UUID],
    controls: dict[str, UUID],
    systems: dict[str, UUID],
    filed: dict[tuple[str, str], UUID],
    data: R.Records,
    evidence: list[F.EvidenceFile],
    settings: Any = None,
) -> dict[str, Any]:
    """Everything after the launch, in the launch's transaction. Returns the counts the
    build records."""
    from ai_workforce_api.evidence_extraction import extract

    by_key = {item.key: item for item in evidence}
    texts = {
        key: extract(item.content, item.file_name, item.content_type).text
        for key, item in by_key.items()
    }
    ctx = Context(
        connection, cursor, organization_id, project_id, team, controls, systems, filed,
        data, by_key, texts, {}, settings,
    )  # fmt: skip
    _criteria(ctx)
    _plans(ctx)
    _requests(ctx)
    _evidence(ctx)
    sheets = _testing(ctx)
    _workpapers(ctx, sheets)
    _reviews(ctx, sheets)
    _deficiencies(ctx, sheets)
    from ai_workforce_api.demo_northstar.closure import run_closure

    ctx.summary["closure"] = run_closure(ctx, sheets)
    return ctx.summary


# Planning


def _criteria(ctx: Context) -> None:
    """The test criteria behind every attribute, prepared with the dataset (SEEDED); the
    lead accepts them after the plan is approved, as a person accepts an agent's."""
    written = 0
    for ref, control_id in ctx.controls.items():
        rows = ctx.cursor.execute(
            "SELECT id, text FROM control_attributes "
            "WHERE engagement_control_id = %s AND status = 'APPROVED' ORDER BY position",
            (control_id,),
        ).fetchall()
        for attribute_id, text in rows:
            criterion = P.criteria_for(ref, str(text))
            if criterion is None:
                continue
            ctx.cursor.execute(
                """
                UPDATE control_attributes
                SET condition = %s, pass_criteria = %s, fail_criteria = %s,
                    judgment_required = %s, automatable = %s, phases = ARRAY['INTERIM', 'ROLLFORWARD'],
                    criteria_origin = %s, version = version + 1
                WHERE id = %s
                """,
                (
                    criterion.condition[:1000],
                    criterion.passes[:1000],
                    criterion.fails[:1000],
                    criterion.judgment,
                    criterion.automatable,
                    SEEDED,
                    attribute_id,
                ),
            )
            _audit(
                ctx, "control_attribute.criteria_set", "control_attribute", attribute_id,
                ctx.team["dana"], {"origin": SEEDED, "control_ref": ref},
            )  # fmt: skip
            written += 1
    ctx.summary["criteria"] = written


def _plans(ctx: Context) -> None:
    """Approve each plan through the planning service, then accept its criteria."""
    from ai_workforce_api.evidence_plans import VersionBody, approve
    from ai_workforce_api.master_plans import AcceptCriteriaBody, AcceptedAttribute, accept_criteria

    approved = 0
    for _ref, control_id in ctx.controls.items():
        row = ctx.cursor.execute(
            "SELECT version FROM evidence_plans WHERE project_id = %s AND engagement_control_id = %s",
            (ctx.project_id, control_id),
        ).fetchone()
        if row is None:
            continue
        approve(
            ctx.connection, ctx.organization_id, ctx.project_id, control_id, ctx.team["dana"],
            VersionBody(version=int(row[0])),
        )  # fmt: skip
        attributes = ctx.cursor.execute(
            "SELECT id, version FROM control_attributes WHERE engagement_control_id = %s "
            "AND status = 'APPROVED' AND criteria_origin = %s",
            (control_id, SEEDED),
        ).fetchall()
        if attributes:
            accept_criteria(
                ctx.connection, ctx.organization_id, ctx.project_id, control_id, ctx.team["dana"],
                AcceptCriteriaBody(
                    attributes=[AcceptedAttribute(id=a[0], version=int(a[1])) for a in attributes]
                ),
            )  # fmt: skip
        approved += 1
    ctx.summary["plans_approved"] = approved


def _requests(ctx: Context) -> None:
    """Release each plan's requests, give the drafts their prepared words, prepare the
    design workpaper, and release the interim phase."""
    from ai_workforce_api.evidence_plans import release
    from ai_workforce_api.phase_release import ReleaseBody
    from ai_workforce_api.phase_release import release as release_phase

    requests = 0
    for ref, control_id in ctx.controls.items():
        release(ctx.connection, ctx.organization_id, ctx.project_id, control_id, ctx.team["dana"])
        rows = ctx.cursor.execute(
            """
            SELECT d.id, r.testing_phase, r.id
            FROM pbc_drafts d JOIN pbc_requests r ON r.id = d.pbc_request_id
            WHERE d.project_id = %s AND d.engagement_control_id = %s AND d.status = 'PENDING'
            """,
            (ctx.project_id, control_id),
        ).fetchall()
        for draft_id, phase, request_id in rows:
            items = ctx.cursor.execute(
                "SELECT title, description, categories FROM evidence_requirements "
                "WHERE pbc_request_id = %s ORDER BY code",
                (request_id,),
            ).fetchall()
            content = {
                "summary": P.REQUEST_SUMMARIES.get(ref, f"Evidence request for {ref}."),
                "items": [
                    {
                        "kind": _kind_of(list(categories or [])),
                        "title": str(title)[:160],
                        "detail": str(description or "")[:600],
                        "fields": [],
                        "period": "1 January to 30 September 2027",
                    }
                    for title, description, categories in items[:8]
                ],
                "questions": [],
                "assumptions": ["Evidence is provided directly by the control owner."],
            }
            ctx.cursor.execute(
                """
                UPDATE pbc_drafts
                SET status = 'DRAFTED', source = %s, content = %s, note = %s, lease_until = NULL,
                    updated_at = clock_timestamp(), version = version + 1
                WHERE id = %s
                """,
                (SEEDED, Json(content), "Prepared with the demo", draft_id),
            )
            requests += 1
            _ = phase
        _design_workpaper(ctx, ref, control_id)
        try:
            release_phase(
                ctx.connection, ctx.organization_id, ctx.project_id, control_id, "INTERIM",
                ctx.team["dana"], ReleaseBody(reason=""),
            )  # fmt: skip
        except Exception as error:  # noqa: BLE001 - a phase the plan does not apply is fine
            logger.info("interim release skipped for %s: %s", ref, error)
    ctx.summary["requests_drafted"] = requests


def _kind_of(categories: list[str]) -> str:
    if "POPULATION" in categories:
        return "population"
    if "CONFIGURATION" in categories:
        return "configuration"
    if "PROCESS_DOCUMENTATION" in categories:
        return "policy"
    return "report"


def _design_workpaper(ctx: Context, ref: str, control_id: UUID) -> None:
    from ai_workforce_api.workpaper_fill import fill, gather
    from ai_workforce_api.workpaper_service import PrepareBody, _prepare, _save, ensure

    ensure(
        ctx.cursor, ctx.organization_id, ctx.project_id, control_id, ctx.team["morgan"], ("DESIGN",)
    )
    row = ctx.cursor.execute(
        "SELECT w.id, c.template_key FROM workpapers w JOIN engagement_controls c "
        "ON c.id = w.engagement_control_id WHERE w.engagement_control_id = %s AND w.stage = 'DESIGN'",
        (control_id,),
    ).fetchone()
    if row is None:
        return
    workpaper_id, template_key = UUID(str(row[0])), str(row[1])
    content = fill(template_key, "DESIGN", gather(ctx.connection, ctx.project_id, control_id))
    _save(ctx.cursor, workpaper_id, content, SEEDED, None, PREPARED_NOTE)  # type: ignore[arg-type]
    ctx.cursor.execute(
        "UPDATE workpapers SET draft_status = 'IDLE', lease_until = NULL WHERE id = %s",
        (workpaper_id,),
    )
    version = _version(ctx, "workpapers", workpaper_id)
    _prepare(
        ctx.connection, ctx.principal("morgan"), ctx.organization_id, ctx.project_id,
        workpaper_id, PrepareBody(version=version, note="Design evaluated from the control's description and the client's configuration."),
    )  # fmt: skip


# Evidence


def _evidence(ctx: Context) -> None:
    """File each stored copy to its control's interim request and the requirement it
    serves, record the receipt, and let the tester accept (or refuse) the evidence."""
    from ai_workforce_api.evidence_plans import SufficiencyBody, set_sufficiency
    from ai_workforce_api.evidence_receipts import apply_receipt

    received = 0
    accepted = 0
    for (key, ref), file_id in sorted(ctx.filed.items(), key=lambda kv: (kv[0][1], kv[0][0])):
        control_id = ctx.controls[ref]
        found = _requirement_for(ctx, control_id, key, ref)
        if found is None:
            continue
        requirement, request = found
        match = ctx.cursor.execute(
            "SELECT id FROM evidence_matches WHERE evidence_file_id = %s", (file_id,)
        ).fetchone()
        assert match is not None
        ctx.cursor.execute(
            """
            UPDATE evidence_matches
            SET pbc_request_id = %s, requirement_id = %s, version = version + 1,
                updated_at = clock_timestamp()
            WHERE id = %s
            """,
            (request, requirement, match[0]),
        )
        _audit(
            ctx, "evidence.filed", "evidence_file", file_id, ctx.team["morgan"],
            {"control_ref": ref, "request_id": str(request), "seeded": True},
        )  # fmt: skip
        if requirement is not None:
            # The reader's coverage of the requirement, as the rules read it: the file is
            # what the request asked for.
            ctx.cursor.execute(
                """
                UPDATE evidence_analyses
                SET classification = jsonb_set(
                        classification, '{items}',
                        %s::jsonb
                    ),
                    version = version + 1, updated_at = clock_timestamp()
                WHERE evidence_file_id = %s
                """,
                (
                    Json(
                        [
                            {
                                "index": 0,
                                "title": ctx.evidence[key].description[:220],
                                "requirement_id": str(requirement),
                                "coverage": "COVERED",
                                "note": "Prepared with the demo: the file is the item requested.",
                            }
                        ]
                    ),  # fmt: skip
                    file_id,
                ),
            )
        apply_receipt(
            ctx.cursor, ctx.organization_id, ctx.project_id, UUID(str(match[0])), request,
            ctx.team["morgan"], "PERSON",
        )  # fmt: skip
        received += 1
    # Acceptance, by the tester, of every requirement a file arrived for; the stale
    # configuration export is refused.
    for ref, control_id in ctx.controls.items():
        interim = _request_of(ctx, control_id, "INTERIM")
        if interim is None:
            continue
        rows = ctx.cursor.execute(
            """
            SELECT q.id, q.version, q.title
            FROM evidence_requirements q
            WHERE q.pbc_request_id = %s AND q.status = 'REQUESTED'
              AND EXISTS (SELECT 1 FROM evidence_matches m
                          WHERE m.pbc_request_id = q.pbc_request_id AND m.requirement_id = q.id)
            ORDER BY q.code
            """,
            (interim,),
        ).fetchall()
        for requirement_id, version, title in rows:
            if ref == "NS-AC-06":
                body = SufficiencyBody(
                    sufficiency="INSUFFICIENT",
                    note=f"The export is dated {R.STALE_EXPORT_DATE.isoformat()}, before the period: it cannot show the configuration in FY2027. A dated export from within the period is needed.",
                    version=int(version),
                )
            else:
                body = SufficiencyBody(
                    sufficiency="ACCEPTED",
                    note=f"Read against the request: {str(title)[:120]} provided directly by the control owner.",
                    version=int(version),
                )
            set_sufficiency(
                ctx.connection, ctx.organization_id, ctx.project_id, control_id,
                UUID(str(requirement_id)), ctx.team["morgan"], body,
            )  # fmt: skip
            accepted += 1 if body.sufficiency == "ACCEPTED" else 0
    ctx.summary["files_received"] = received
    ctx.summary["requirements_accepted"] = accepted


def _request_of(ctx: Context, control_id: UUID, phase: str) -> UUID | None:
    row = ctx.cursor.execute(
        """
        SELECT id FROM pbc_requests
        WHERE project_id = %s AND engagement_control_id = %s AND testing_phase = %s
          AND operation_key LIKE 'plan-%%'
        ORDER BY created_at LIMIT 1
        """,
        (ctx.project_id, control_id, phase),
    ).fetchone()
    return None if row is None else UUID(str(row[0]))


def _requirement_for(
    ctx: Context, control_id: UUID, key: str, ref: str
) -> tuple[UUID, UUID] | None:
    """The requirement a file serves, and the request that asked for it: the population
    item for the control's population file, otherwise the first requirement of the
    interim requests whose category fits the file."""
    rows = ctx.cursor.execute(
        """
        SELECT q.id, q.categories, q.pbc_request_id
        FROM evidence_requirements q
        JOIN pbc_requests r ON r.id = q.pbc_request_id
        WHERE r.project_id = %s AND r.engagement_control_id = %s AND r.testing_phase = 'INTERIM'
          AND r.operation_key LIKE 'plan-%%' AND q.status NOT IN ('WAIVED', 'REMOVED')
        ORDER BY r.created_at, q.code
        """,
        (ctx.project_id, control_id),
    ).fetchall()
    if not rows:
        return None
    population_key = POPULATIONS.get(ref, ("", ()))[0]
    wanted = (
        ("POPULATION",)
        if key == population_key
        else ("CONFIGURATION",)
        if key in ("tolerance_config", "conditional_access")
        else ("REPORT_RELIABILITY", "CONTROL_EXECUTION", "SAMPLE", "OTHER")
    )
    for category in wanted:
        for requirement_id, categories, request_id in rows:
            if category in (categories or []):
                return UUID(str(requirement_id)), UUID(str(request_id))
    return UUID(str(rows[0][0])), UUID(str(rows[0][2]))


# Testing


@dataclass
class Sheet:
    ref: str
    control_id: UUID
    sheet_id: UUID
    conclusion: str  # EFFECTIVE, NOT_EFFECTIVE, INCOMPLETE
    items: int
    exceptions: int


def _testing(ctx: Context) -> dict[str, Sheet]:
    """Samples from the population files, the sheets the approvals open, the files on
    each item, the results with their citations, and the tester's sign-off."""
    from ai_workforce_api import sampling
    from ai_workforce_api.control_tests import (
        VersionBody,
        _approve,
        control_for_population,
        propose,
    )
    from ai_workforce_api.evidence_extraction import read_table
    from ai_workforce_api.testing_engine import create_single_sheet

    sheets: dict[str, Sheet] = {}
    for control in R.CONTROLS:
        ref, control_id = control.ref, ctx.controls[control.ref]
        if control.nature == "AUTOMATED":
            sheet_id = create_single_sheet(
                ctx.cursor, ctx.organization_id, ctx.project_id, control_id, ctx.team["morgan"],
                "configuration",
            )  # fmt: skip
            if sheet_id is None:
                sheet_id = _sheet_of(ctx, control_id)
        else:
            population_key, required = POPULATIONS[ref]
            item = ctx.evidence[population_key]
            table = read_table(item.content, item.file_name, item.content_type)
            facts = control_for_population(ctx.connection, ctx.project_id, control_id)
            if table is None or facts is None:
                logger.info("no population for %s", ref)
                continue
            period_end, frequency, nature, size, tester = facts
            frame = sampling.build_frame(table, period_end, frequency)
            seed = _seed_containing(table, frame, size, required)
            test_id = propose(
                ctx.cursor, organization_id=ctx.organization_id, project_id=ctx.project_id,
                control_id=control_id, file_id=ctx.file_id(population_key, ref),
                file_name=item.file_name, sha256=_sha(ctx, population_key, ref), table=table,
                period_end=period_end, frequency=frequency, nature=nature, size=size,
                proposer=ctx.team["morgan"], tester=tester, seed=seed,
            )  # fmt: skip
            if test_id is None:
                continue
            _approve(
                ctx.connection, ctx.principal("dana"), ctx.organization_id, ctx.project_id,
                test_id, VersionBody(version=_version(ctx, "control_tests", test_id)),
            )  # fmt: skip
            sheet_id = _sheet_of(ctx, control_id)
        if sheet_id is None:
            continue
        ctx.cursor.execute(
            "UPDATE test_sheets SET run_status = 'IDLE', version = version + 1 WHERE id = %s",
            (sheet_id,),
        )
        exceptions = _results(ctx, control, sheet_id)
        sheets[ref] = Sheet(ref, control_id, sheet_id, "", 0, exceptions)
        _sign_sheet(ctx, sheets[ref])
    ctx.summary["sheets"] = {ref: s.conclusion for ref, s in sheets.items()}
    return sheets


def _seed_containing(table: Any, frame: Any, size: int, required: tuple[str, ...]) -> int:
    from ai_workforce_api import sampling

    key = frame.key_column
    for seed in range(1, 5000):
        picked = sampling.select(frame.rows, size, seed)
        keys = {table.rows[i][key].strip() for i in picked} if key is not None else set()
        if all(r in keys for r in required):
            return seed
    raise ValueError(f"no seed yields a sample with {required}")


def _sheet_of(ctx: Context, control_id: UUID) -> UUID | None:
    row = ctx.cursor.execute(
        "SELECT id FROM test_sheets WHERE project_id = %s AND engagement_control_id = %s "
        "AND test_round_id IS NULL",
        (ctx.project_id, control_id),
    ).fetchone()
    return None if row is None else UUID(str(row[0]))


def _results(ctx: Context, control: R.Control, sheet_id: UUID) -> int:
    """Place the control's files on every item and write each item's results, every
    result cited from the files' own text."""
    population_key = POPULATIONS.get(control.ref, ("", ()))[0]
    files = [
        (key, ctx.file_id(key, control.ref))
        for key in control.files
        if (key, control.ref) in ctx.filed
    ]
    return _results_for_files(
        ctx, control, sheet_id, files, population_key, {key: ctx.evidence[key] for key, _ in files}
    )


def _results_for_files(
    ctx: Context,
    control: R.Control,
    sheet_id: UUID,
    files: list[tuple[str, UUID]],
    population_key: str,
    by_key: dict[str, F.EvidenceFile],
) -> int:
    """The results of one sheet from the given files (keyed as the evaluators know them:
    a round's later population stands in for the interim's under the same key)."""
    from ai_workforce_api.test_citations import CitedFile, check_citations

    cited = tuple(
        CitedFile(
            file_id=file_id,
            file_name=by_key[key].file_name,
            text=ctx.texts[key],
            seen_as_image=False,
        )
        for key, file_id in files
    )
    index_of = {key: n for n, (key, _) in enumerate(files)}
    only_population = len(files) == 1 and files[0][0] == population_key
    for key, file_id in files:
        ctx.cursor.execute(
            """
            INSERT INTO test_sheet_files (test_sheet_id, evidence_file_id, placement, placed_by, decided_by, reason)
            VALUES (%s, %s, %s, 'PERSON', %s, %s)
            ON CONFLICT DO NOTHING
            """,
            (
                sheet_id,
                file_id,
                "EXCLUDED" if key == population_key and not only_population else "PLACED",
                ctx.team["morgan"],
                "The population sampled from" if key == population_key else "Placed by the tester",
            ),
        )
    items = ctx.cursor.execute(
        "SELECT id, label, version FROM test_items WHERE test_sheet_id = %s ORDER BY position",
        (sheet_id,),
    ).fetchall()
    exceptions = 0
    for item_id, label, version in items:
        for key, file_id in files:
            if key != population_key or control.nature == "AUTOMATED" or only_population:
                ctx.cursor.execute(
                    "INSERT INTO test_item_files (test_item_id, evidence_file_id) VALUES (%s, %s) "
                    "ON CONFLICT DO NOTHING",
                    (item_id, file_id),
                )
        raw = _evaluate(ctx, control, str(label))
        results = []
        for n, outcome in enumerate(raw):
            citations = check_citations(
                [{"file": index_of[k], "quote": q} for k, q in outcome.quotes if k in index_of],
                cited,
            )
            if outcome.result == "PASS" and not any(c.get("found") for c in citations):
                outcome.result, outcome.note = "UNABLE", "No cited evidence supports the attribute."
            results.append(
                {
                    "index": n,
                    "result": outcome.result,
                    "note": outcome.note[:400],
                    "observed": outcome.observed[:400],
                    "expected": outcome.expected[:400],
                    "limitations": "",
                    "citations": citations,
                    "checks": [],
                }
            )
        if any(r["result"] == "EXCEPTION" for r in results):
            exceptions += 1
        ctx.cursor.execute(
            """
            UPDATE test_items
            SET results = %s, source = %s, tested_at = clock_timestamp(), note = %s,
                needs_test = false, version = version + 1
            WHERE id = %s AND version = %s
            """,
            (
                Json(results),
                SEEDED,
                "Prepared with the demo (simulated): results read from the evidence files as of 30 September 2027.",
                item_id,
                version,
            ),
        )
    return exceptions


@dataclass
class Outcome:
    result: str  # PASS, EXCEPTION, UNABLE, NOT_APPLICABLE
    observed: str = ""
    expected: str = ""
    note: str = ""
    # (file key, quote) pairs; the quote is the file's own words.
    quotes: list[tuple[str, str]] = None  # type: ignore[assignment]

    def __post_init__(self) -> None:
        if self.quotes is None:
            self.quotes = []


def _pass(key: str, quote: str, observed: str, expected: str) -> Outcome:
    return Outcome("PASS", observed, expected, "", [(key, quote)])


def _fail(key: str, quote: str, observed: str, expected: str) -> Outcome:
    return Outcome("EXCEPTION", observed, expected, "", [(key, quote)])


def _row(rows: list[dict[str, object]], field: str, value: str) -> dict[str, object] | None:
    return next((r for r in rows if str(r.get(field)) == value), None)


def _cells(row: dict[str, object], *keys: str) -> str:
    """Consecutive cells of a row as the extracted table text joins them."""
    return " | ".join(F._cell(row.get(k)) for k in keys)


def _evaluate(ctx: Context, control: R.Control, label: str) -> list[Outcome]:
    """What the evidence says about one sampled item, attribute by attribute. Read from
    the records the files were rendered from, cited with the files' own cells."""
    d = ctx.data
    ref = control.ref
    pass_ = _pass
    fail = _fail

    if ref == "NS-AC-01":
        r = _row(d.access_requests, "request_id", label)
        if r is None:
            return [
                Outcome("UNABLE", note="Request not in the export.") for _ in control.attributes
            ]
        q = _cells(
            r,
            "request_id",
            "sap_user",
            "name",
            "request_type",
            "roles_requested",
            "roles_provisioned",
            "requested_by",
            "manager_approval",
            "role_owner",
            "role_owner_approval",
            "provisioned_on",
        )
        return [
            pass_(
                "access_requests",
                q,
                f"Manager approval {r['manager_approval']}, provisioned {r['provisioned_on']}",
                "manager approval on or before provisioning",
            ),
            pass_(
                "access_requests",
                q,
                f"Role owner approval {r['role_owner_approval']}, provisioned {r['provisioned_on']}",
                "role owner approval on or before provisioning",
            ),
            pass_(
                "access_requests",
                q,
                f"Requested {r['roles_requested']}; provisioned {r['roles_provisioned']}",
                "roles provisioned equal roles requested",
            ),
        ]
    if ref == "NS-AC-02":
        hr = _row(d.hr_terminations, "employee_id", label)
        user = _row(d.sap_users, "employee_id", label)
        removal = _row(d.termination_removals, "employee_id", label)
        if hr is None or user is None:
            return [
                Outcome("UNABLE", note="Person not in the listings.") for _ in control.attributes
            ]
        uq = _cells(
            user,
            "user_id",
            "full_name",
            "employee_id",
            "user_type",
            "department",
            "company_code",
            "created_on",
            "valid_from",
            "valid_to",
            "lock_status",
        )
        hq = _cells(hr, "employee_id", "name", "department", "entity", "termination_date")
        locked = user["lock_status"] == 64 and str(user["valid_to"]) != "9999-12-31"
        out = [
            (pass_ if locked else fail)(
                "sap_users",
                uq,
                f"Lock status {user['lock_status']}, valid to {user['valid_to']}",
                "lock status 64 and validity ended at the lock date",
            ),
        ]
        if removal is None:
            out.append(
                Outcome(
                    "EXCEPTION",
                    f"No removal entry; terminated {hr['termination_date']} per HR, account still valid to {user['valid_to']}",
                    "lock within 3 business days of the termination date",
                    "",
                    [("hr_terminations", hq), ("sap_users", uq)],
                )
            )
            out.append(
                Outcome(
                    "EXCEPTION",
                    "No entry in the termination removal log",
                    "a removal log entry with HR's termination date",
                    "",
                    [("hr_terminations", hq)],
                )
            )
            return out
        rq = _cells(
            removal, "employee_id", "sap_user", "termination_date", "lock_date", "business_days"
        )
        days = int(str(removal["business_days"]))
        out.append(
            (pass_ if days <= 3 else fail)(
                "termination_removals",
                rq,
                f"{days} business days from {removal['termination_date']} to {removal['lock_date']}",
                "3 business days or fewer",
            )
        )
        out.append(
            (pass_ if removal["termination_date"] == hr["termination_date"] else fail)(
                "termination_removals",
                rq,
                f"Removal log termination date {removal['termination_date']}; HR {hr['termination_date']}",
                "removal logged with HR's termination date",
            )
        )
        return out
    if ref == "NS-AC-03":
        r = _row(d.privileged_access, "user_id", label)
        if r is None:
            return [Outcome("UNABLE", note="Holder not on the report.") for _ in control.attributes]
        q = _cells(
            r,
            "user_id",
            "full_name",
            "user_type",
            "profile",
            "assigned_on",
            "approved_list",
            "approval_ref",
        )
        approved = str(r["approved_list"]) == "Yes" and str(r["approval_ref"]) != ""
        sessions = [s for s in d.firefighter_log if s["firefighter_id"] == r["user_id"]]
        out = [
            (pass_ if approved else fail)(
                "privileged_access",
                q,
                f"{r['profile']} on {r['user_type']} user {r['full_name']}; approved list {r['approved_list']}; reference {r['approval_ref'] or 'blank'}",
                "approved system or firefighter account, or an approved firefighter request",
            )
        ]
        if sessions:
            s = sessions[0]
            sq = _cells(
                s,
                "request_id",
                "firefighter_id",
                "requested_by",
                "sap_user",
                "reason",
                "approved_by",
                "approved_on",
            )
            late = R.business_days_between(s["approved_on"], s["log_reviewed_on"]) > 5  # type: ignore[arg-type]
            out.append(
                (fail if late else pass_)(
                    "firefighter_log",
                    sq,
                    f"Session {s['request_id']} log reviewed {s['log_reviewed_on']}",
                    "log reviewed within 5 business days",
                )
            )
        else:
            out.append(
                Outcome("NOT_APPLICABLE", note="Not a firefighter ID: no session log to review.")
            )
        return out
    if ref == "NS-AC-04":
        c = _row(d.access_certifications, "campaign_id", label)
        if c is None:
            return [
                Outcome("UNABLE", note="Campaign not in the report.") for _ in control.attributes
            ]
        q = _cells(
            c,
            "campaign_id",
            "scope",
            "opened_on",
            "closed_on",
            "due_on",
            "assignments",
            "decided",
            "approved",
            "denied",
        )
        revoked = [r for r in d.certification_revocations if r["campaign_id"] == label]
        rq = (
            _cells(
                revoked[0],
                "campaign_id",
                "sap_user",
                "name",
                "group",
                "decision",
                "decided_by",
                "revoked_on",
            )
            if revoked
            else q
        )
        return [
            pass_(
                "access_certifications",
                q,
                f"Closed {c['closed_on']}, due {c['due_on']}, completion {c['completion']}",
                "closed on or before the due date, 100% complete",
            ),
            pass_(
                "access_certifications",
                q,
                f"Decided {c['decided']} of {c['assignments']}",
                "every assignment decided",
            ),
            (pass_ if len(revoked) == c["denied"] else fail)(
                "certification_revocations",
                rq,
                f"{len(revoked)} revocations for {c['denied']} denials, first revoked {revoked[0]['revoked_on'] if revoked else 'n/a'}",
                "every denial revoked after the campaign closed",
            ),
        ]
    if ref == "NS-AC-05":
        r = (
            _row(d.entra_pim, "upn", label)
            or _row(d.entra_pim, "approval_ref", label)
            or _row(d.entra_pim, "principal", label)
        )
        if r is None:
            return [
                Outcome("UNABLE", note="Assignment not in the export.") for _ in control.attributes
            ]
        q = _cells(
            r,
            "role",
            "principal",
            "upn",
            "assignment_type",
            "mfa_required",
            "assigned_on",
            "approval_ref",
        )
        approval = _row(d.entra_role_approvals, "approval_ref", str(r["approval_ref"]))
        glass = str(r["principal"]) == "Break-glass account"
        aq = (
            _cells(
                approval,
                "approval_ref",
                "role",
                "principal",
                "requested_by",
                "approved_by",
                "approved_on",
            )
            if approval
            else q
        )
        return [
            (pass_ if approval or glass else fail)(
                "entra_role_approvals" if approval else "entra_pim",
                aq,
                f"Approval {r['approval_ref']} for {r['role']}",
                "an approved request for the role and person",
            ),
            (pass_ if r["assignment_type"] == "Eligible" or glass else fail)(
                "entra_pim",
                q,
                f"Assignment type {r['assignment_type']}",
                "eligible, or an approved break-glass account",
            ),
            (pass_ if str(r["mfa_required"]).startswith(("Yes", "N/A")) else fail)(
                "entra_pim",
                q,
                f"MFA on activation: {r['mfa_required']}",
                "MFA required at activation",
            ),
        ]
    if ref == "NS-AC-06":
        policy = _row(d.conditional_access, "policy_id", "CA001")
        assert policy is not None
        q = _cells(policy, "policy_id", "name", "state", "users", "exclusions")
        return [
            Outcome(
                "UNABLE",
                f"Export dated {R.STALE_EXPORT_DATE}: CA001 {policy['state']} for {policy['users']}, but the export predates the period",
                "CA001 On for all users during FY2027, evidenced within the period",
                "The export is dated before the period; a dated export from FY2027 is needed.",
                [("conditional_access", q)],
            ),
            pass_(
                "conditional_access",
                q,
                f"Exclusions: {policy['exclusions']}",
                "only the two break-glass accounts excluded",
            ),
        ]
    if ref == "NS-AC-07":
        r = _row(d.snowflake_grants, "grant_id", label)
        if r is None:
            return [Outcome("UNABLE", note="Grant not in the export.") for _ in control.attributes]
        q = _cells(
            r,
            "grant_id",
            "role",
            "granted_to",
            "grantee_name",
            "granted_by",
            "created_on",
            "approval_ref",
        )
        privileged = str(r["role"]) in ("ACCOUNTADMIN", "SECURITYADMIN", "SYSADMIN")
        approval = _row(d.snowflake_role_approvals, "approval_ref", str(r["approval_ref"]))
        aq = (
            _cells(approval, "approval_ref", "role", "grantee", "approved_by", "approved_on")
            if approval
            else q
        )
        return [
            (
                pass_(
                    "snowflake_role_approvals",
                    aq,
                    f"Approval {r['approval_ref']} for {r['role']}",
                    "an approved request",
                )
                if privileged and approval
                else Outcome(
                    "NOT_APPLICABLE",
                    note=f"{r['role']} is not a privileged role.",
                    quotes=[("snowflake_grants", q)],
                )
                if not privileged
                else fail(
                    "snowflake_grants", q, f"No approval for {r['role']}", "an approved request"
                )
            ),
            (
                pass_(
                    "snowflake_grants", q, f"Grantee {r['grantee_name']}", "a named person's user"
                )
                if privileged
                else Outcome(
                    "NOT_APPLICABLE",
                    note=f"{r['role']} is not a privileged role.",
                    quotes=[("snowflake_grants", q)],
                )
            ),
        ]
    if ref == "NS-CM-01":
        t = _row(d.transport_log, "transport_id", label)
        if t is None:
            return [
                Outcome("UNABLE", note="Transport not in the import log.")
                for _ in control.attributes
            ]
        ticket = _row(d.change_tickets, "ticket", str(t["change_ticket"]))
        tq = _cells(t, "transport_id", "description", "type", "owner", "imported_by", "import_date")
        if ticket is None:
            return [
                fail("transport_log", tq, "No change ticket", "an approved ticket")
                for _ in control.attributes
            ]
        cq = _cells(
            ticket,
            "ticket",
            "short_description",
            "category",
            "requested_by",
            "raised_on",
            "transports",
            "approval_date",
            "approved_by",
            "test_evidence",
        )
        approved_on = ticket["approval_date"]
        assert approved_on is None or isinstance(approved_on, date)
        imported = t["import_date"]
        assert isinstance(imported, date)
        ok_approval = approved_on is not None and approved_on <= imported
        out = [
            Outcome(
                "PASS" if ok_approval else "EXCEPTION",
                f"Approval {approved_on or 'blank'} by {ticket['approved_by'] or 'nobody'}; imported {t['import_date']}",
                "approval recorded on or before the import date",
                "",
                [("change_tickets", cq), ("transport_log", tq)],
            ),
            (pass_ if ticket["test_evidence"] else fail)(
                "change_tickets",
                cq,
                f"Test evidence: {ticket['test_evidence'] or 'blank'}",
                "test evidence attached",
            ),
            (pass_ if t["owner"] != t["imported_by"] else fail)(
                "transport_log",
                tq,
                f"Owner {t['owner']}, imported by {t['imported_by']}",
                "importer differs from owner",
            ),
        ]
        return out
    if ref == "NS-CM-02":
        r = _row(d.pipeline_prs, "pr_id", label)
        if r is None:
            return [
                Outcome("UNABLE", note="Pull request not in the export.")
                for _ in control.attributes
            ]
        q = _cells(
            r, "pr_id", "title", "author", "reviewer", "review_state", "approved_at", "merged_at"
        )
        return [
            (pass_ if r["review_state"] == "Approved" and r["author"] != r["reviewer"] else fail)(
                "pipeline_prs",
                q,
                f"{r['review_state']} by {r['reviewer']}; author {r['author']}",
                "approving review by someone else",
            ),
            (pass_ if str(r["approved_at"]) < str(r["merged_at"]) else fail)(
                "pipeline_prs",
                q,
                f"Approved {r['approved_at']}, merged {r['merged_at']}",
                "approval before merge",
            ),
        ]
    if ref == "NS-OP-01":
        r = _row(d.batch_monitoring, "job_run", label)
        if r is None:
            return [Outcome("UNABLE", note="Job run not on the sheet.") for _ in control.attributes]
        q = _cells(
            r,
            "job_run",
            "run_date",
            "job_name",
            "status",
            "start_time",
            "incident",
            "resolution",
            "resolved_on",
            "reviewed_by",
            "reviewed_on",
        )
        resolved = r["status"] != "Cancelled" or (r["incident"] and r["resolution"])
        return [
            pass_(
                "batch_monitoring",
                q,
                f"Reviewed by {r['reviewed_by']} on {r['reviewed_on']}",
                "review performed and signed",
            ),
            (pass_ if resolved else fail)(
                "batch_monitoring",
                q,
                f"Status {r['status']}; incident {r['incident'] or 'none needed'}",
                "every cancelled job has an incident and resolution",
            ),
        ]
    if ref == "NS-OP-02":
        r = _row(d.task_history, "run_id", label)
        if r is None:
            return [Outcome("UNABLE", note="Run not in the history.") for _ in control.attributes]
        q = _cells(
            r,
            "run_id",
            "run_date",
            "task_name",
            "scheduled_time",
            "state",
            "error_message",
            "incident",
            "resolution",
        )
        failed = r["state"] == "FAILED"
        handled = bool(r["incident"]) and bool(r["resolution"])
        if not failed:
            return [
                Outcome(
                    "NOT_APPLICABLE",
                    note="The run succeeded; nothing to resolve.",
                    quotes=[("task_history", q)],
                ),
                Outcome(
                    "NOT_APPLICABLE",
                    note="The run succeeded; no rerun.",
                    quotes=[("task_history", q)],
                ),
            ]
        return [
            (pass_ if handled else fail)(
                "task_history",
                q,
                f"State FAILED; incident {r['incident'] or 'blank'}; resolution {r['resolution'] or 'blank'}",
                "an incident and a recorded resolution",
            ),
            (pass_ if "rerun" in str(r["resolution"]).lower() else fail)(
                "task_history",
                q,
                f"Resolution: {r['resolution'] or 'blank'}",
                "a successful rerun recorded",
            ),
        ]
    if ref == "NS-AP-01":
        config = d.tolerance_config[0]
        cq = _cells(
            config,
            "company_code",
            "tolerance_key",
            "description",
            "lower_pct",
            "upper_pct",
            "lower_abs_usd",
            "upper_abs_usd",
        )
        outside_unblocked = [
            r
            for r in d.ap_invoices
            if (
                abs(Decimal(str(r["variance_pct"]))) > 5
                or abs(Decimal(str(r["variance_usd"]))) > 500
            )
            and r["payment_block"] != "R"
        ]
        inside_blocked = [
            r
            for r in d.ap_invoices
            if abs(Decimal(str(r["variance_pct"]))) <= 5
            and abs(Decimal(str(r["variance_usd"]))) <= 500
            and r["payment_block"] == "R"
        ]
        blocked = d.blocked_invoices[0]
        bq = _cells(
            blocked,
            "invoice",
            "company_code",
            "vendor",
            "posting_date",
            "invoice_amount_usd",
            "variance_usd",
            "variance_pct",
            "block_reason",
        )
        all_ok = all(
            c["upper_pct"] == "5.0" and c["upper_abs_usd"] == "500.00" for c in d.tolerance_config
        )
        return [
            (pass_ if all_ok else fail)(
                "tolerance_config",
                cq,
                "PE 5.0% / USD 500.00 for company codes 1000, 2000, 3000, 4000",
                "5% / USD 500 for every company code",
            ),
            (pass_ if not outside_unblocked else fail)(
                "blocked_invoices",
                bq,
                f"{len(d.blocked_invoices)} invoices outside tolerance, all blocked R; {len(outside_unblocked)} unblocked",
                "every invoice outside tolerance blocked",
            ),
            (pass_ if not inside_blocked else fail)(
                "ap_invoices",
                _cells(
                    d.ap_invoices[0],
                    "invoice",
                    "company_code",
                    "vendor",
                    "purchase_order",
                    "posting_date",
                    "po_amount_usd",
                    "invoice_amount_usd",
                    "variance_usd",
                    "variance_pct",
                ),
                f"{len(inside_blocked)} invoices inside tolerance blocked",
                "no invoice inside tolerance blocked",
            ),
        ]
    if ref == "NS-IP-01":
        month = _row(d.close_calendar, "period", label)
        if month is None:
            return [
                Outcome("UNABLE", note="Month not on the calendar.") for _ in control.attributes
            ]
        if label == "2027-09":
            recon = d.ipe_reconciliation
            key, report_key = "ipe_reconciliation", "revenue_report"
            report = d.revenue_report
            gl = d.gl_revenue
        elif label == "2027-08":
            recon = d.ipe_reconciliation_aug
            key, report_key = "ipe_reconciliation_aug", "revenue_report_aug"
            report = d.revenue_report_aug
            gl = d.gl_revenue_aug
        else:
            return [
                Outcome("UNABLE", note=f"No reconciliation provided for {label}.")
                for _ in control.attributes
            ]
        diff = next(r for r in recon if r["line"] == "Difference")
        dq = _cells(diff, "line", "amount_usd")
        explained = any(str(r["line"]).startswith("Agreed") for r in recon)
        codes_report = {str(r["company_code"]) for r in report}
        codes_gl = {str(r["company_code"]) for r in gl}
        missing = sorted(codes_gl - codes_report)
        reviewed = any(
            str(r["line"]).startswith("Reviewed by ") and len(str(r["line"])) > len("Reviewed by ")
            for r in recon
        )
        return [
            (pass_ if diff["amount_usd"] == Decimal("0.00") or explained else fail)(
                key,
                dq,
                f"Difference {diff['amount_usd']}; {'agreed' if explained else 'explanation blank'}",
                "zero difference, or explained and resolved",
            ),
            (pass_ if not missing else fail)(
                report_key,
                _cells(report[0], "customer_id", "customer", "company_code", "entity"),
                f"Company codes in report: {', '.join(sorted(codes_report))}; missing: {', '.join(missing) or 'none'}",
                "every company code with ledger revenue present",
            ),
            (pass_ if reviewed else fail)(
                key,
                _cells(next(r for r in recon if str(r["line"]).startswith("Reviewed by")), "line"),
                "Reviewer " + ("named" if reviewed else "blank"),
                "preparer and reviewer named",
            ),
        ]
    if ref == "NS-MR-01":
        month = _row(d.close_calendar, "period", label)
        if month is None:
            return [
                Outcome("UNABLE", note="Month not on the calendar.") for _ in control.attributes
            ]
        mq = _cells(
            month, "period", "period_end", "ledger_closed", "flux_report_run", "controller_review"
        )
        if label == "2027-09":
            over = [r for r in d.flux_analysis if r["over_threshold"] == "Yes"]
            blank = [r for r in over if not r["explanation"]]
            fq = _cells(
                blank[0] if blank else over[0],
                "gl_account",
                "account_name",
                "august_usd",
                "september_usd",
                "variance_usd",
                "variance_pct",
                "over_threshold",
                "explanation",
            )
            signed_after = R.SEPTEMBER_REVIEW_DATE >= R.SEPTEMBER_REPORT_RUN
            memo_key = "close_memo_sep"
            memo_quote = f"Reviewed and signed: Grace Lindqvist, Corporate Controller, {R.SEPTEMBER_REVIEW_DATE.isoformat()}."
            run_quote = f"Flux analysis report run: {R.SEPTEMBER_REPORT_RUN.isoformat()}"
            return [
                (fail if blank else pass_)(
                    "flux_analysis",
                    fq,
                    f"{len(over)} variances over the threshold; {len(blank)} without an explanation ({', '.join(str(b['gl_account']) for b in blank) or 'none'})",
                    "every variance over the threshold explained",
                ),
                Outcome(
                    "PASS" if signed_after else "EXCEPTION",
                    f"Signed {R.SEPTEMBER_REVIEW_DATE}, report run {R.SEPTEMBER_REPORT_RUN}",
                    "review signed on or after the report run",
                    "",
                    [(memo_key, memo_quote), (memo_key, run_quote)],
                ),
                pass_(
                    memo_key, memo_quote, "Grace Lindqvist, Corporate Controller", "the Controller"
                ),
            ]
        if label == "2027-08":
            memo_key = "close_memo_aug"
            memo_quote = f"Reviewed and signed: Grace Lindqvist, Corporate Controller, {R.AUGUST_REVIEW_DATE.isoformat()}."
            run_quote = f"Flux analysis report run: {R.AUGUST_REPORT_RUN.isoformat()}"
            return [
                pass_(
                    memo_key,
                    "Accounts over the threshold this month: 6300 Sales commissions (+11.2%), explained by the mid-year plan true-up.",
                    "One variance over the threshold, explained on the memo",
                    "every variance over the threshold explained",
                ),
                Outcome(
                    "EXCEPTION",
                    f"Signed {R.AUGUST_REVIEW_DATE}, report run {R.AUGUST_REPORT_RUN}: signed two days before the report",
                    "review signed on or after the report run",
                    "",
                    [(memo_key, memo_quote), (memo_key, run_quote)],
                ),
                pass_(
                    memo_key, memo_quote, "Grace Lindqvist, Corporate Controller", "the Controller"
                ),
            ]
        return [
            Outcome(
                "UNABLE", note=f"No memo provided for {label}.", quotes=[("close_calendar", mq)]
            )
            for _ in control.attributes
        ]
    return [Outcome("UNABLE", note="No evaluation for this control.") for _ in control.attributes]


def _sign_sheet(ctx: Context, sheet: Sheet) -> None:
    """The tester signs the sheet when its conclusion is complete; a not-effective
    conclusion proposes a deficiency the lead logs."""
    from ai_workforce_api.test_sheets import (
        DeficiencyDecision,
        SignOffBody,
        change_sheet,
        decide_deficiency,
        sign_off_work,
    )

    try:
        body, _queued = change_sheet(
            ctx.connection, ctx.principal("morgan"), ctx.organization_id, ctx.project_id,
            sheet.sheet_id,
            sign_off_work(SignOffBody(version=_version(ctx, "test_sheets", sheet.sheet_id), note="Tested as of 30 September 2027 from the evidence the control owner provided (prepared with the demo).")),
        )  # fmt: skip
    except Exception as error:  # noqa: BLE001 - an incomplete sheet stays open, as it should
        logger.info("sheet for %s stays open: %s", sheet.ref, error)
        sheet.conclusion = "INCOMPLETE"
        return
    sheet.conclusion = str(body.conclusion or "")
    sheet.items = len(body.items) if hasattr(body, "items") else 0
    if sheet.conclusion == "NOT_EFFECTIVE":
        decide_deficiency(
            ctx.connection, ctx.principal("dana"), ctx.organization_id, ctx.project_id,
            sheet.sheet_id,
            DeficiencyDecision(
                version=_version(ctx, "test_sheets", sheet.sheet_id), action="LOG",
                reason="Logged from the interim testing exceptions.",
                severity=DEFICIENCY_SEVERITY.get(sheet.ref, "CONTROL_DEFICIENCY"),  # type: ignore[arg-type]
            ),
        )  # fmt: skip


# Workpapers and reviews


def _workpapers(ctx: Context, sheets: dict[str, Sheet]) -> None:
    """The effectiveness workpaper of every signed sheet: prepared content (SEEDED) and
    the tester's preparation, which opens the independent review."""
    from ai_workforce_api.workpaper_fill import fill, gather
    from ai_workforce_api.workpaper_service import PrepareBody, _prepare, _save, ensure

    prepared = 0
    for ref, sheet in sheets.items():
        if sheet.conclusion not in ("EFFECTIVE", "NOT_EFFECTIVE"):
            continue
        ensure(
            ctx.cursor,
            ctx.organization_id,
            ctx.project_id,
            sheet.control_id,
            ctx.team["morgan"],
            ("EFFECTIVENESS",),
        )
        row = ctx.cursor.execute(
            "SELECT w.id, c.template_key FROM workpapers w JOIN engagement_controls c ON c.id = w.engagement_control_id "
            "WHERE w.engagement_control_id = %s AND w.stage = 'EFFECTIVENESS'",
            (sheet.control_id,),
        ).fetchone()
        if row is None:
            continue
        workpaper_id, template_key = UUID(str(row[0])), str(row[1])
        content = fill(
            template_key, "EFFECTIVENESS", gather(ctx.connection, ctx.project_id, sheet.control_id)
        )
        _save(ctx.cursor, workpaper_id, content, SEEDED, None, PREPARED_NOTE)  # type: ignore[arg-type]
        ctx.cursor.execute(
            "UPDATE workpapers SET draft_status = 'IDLE', lease_until = NULL WHERE id = %s",
            (workpaper_id,),
        )
        _prepare(
            ctx.connection, ctx.principal("morgan"), ctx.organization_id, ctx.project_id,
            workpaper_id, PrepareBody(version=_version(ctx, "workpapers", workpaper_id), note="Interim testing documented as of 30 September 2027."),
        )  # fmt: skip
        prepared += 1
        _ = ref
    ctx.summary["workpapers_prepared"] = prepared


def _reviews(ctx: Context, sheets: dict[str, Sheet]) -> None:
    """The independent reviewer's work: the re-performance recorded as prepared, notes
    raised, answered and cleared, one workpaper returned and prepared again, and the
    reviews signed; some wait as pending review."""
    from ai_workforce_api.control_reviews import (
        NoteClear,
        NoteCreate,
        NoteResponse,
        SignOffBody,
        _add_note,
        _clear_note,
        _finish,
        _respond_note,
        _sign_off,
    )

    signed = 0
    notes = 0
    for ref, sheet in sheets.items():
        row = ctx.cursor.execute(
            "SELECT id FROM control_reviews WHERE project_id = %s AND engagement_control_id = %s AND test_round_id IS NULL",
            (ctx.project_id, sheet.control_id),
        ).fetchone()
        if row is None:
            continue
        review_id = UUID(str(row[0]))
        riley, morgan = ctx.principal("riley"), ctx.principal("morgan")
        if ref in P.REVIEW_NOTES:
            severity, text, response = P.REVIEW_NOTES[ref]
            # A must-fix note names the effectiveness workpaper it is about: the review
            # reopens that one, not the control's design workpaper as well.
            paper = ctx.cursor.execute(
                "SELECT id FROM workpapers WHERE engagement_control_id = %s AND stage = 'EFFECTIVENESS'",
                (sheet.control_id,),
            ).fetchone()
            must_fix = severity == "MUST_FIX" and paper is not None
            _add_note(
                ctx.connection, riley, ctx.organization_id, ctx.project_id, review_id,
                NoteCreate(version=_version(ctx, "control_reviews", review_id), target_kind="WORKPAPER" if must_fix else "GENERAL", severity=severity, text=text, workpaper_id=UUID(str(paper[0])) if paper is not None and must_fix else None),  # type: ignore[arg-type]
            )  # fmt: skip
            notes += 1
            note_id = ctx.cursor.execute(
                "SELECT id FROM review_notes WHERE control_review_id = %s ORDER BY number DESC LIMIT 1",
                (review_id,),
            ).fetchone()
            assert note_id is not None
            if severity == "MUST_FIX":
                # Returned to the preparer: the sheet and the workpaper reopened; the tester
                # signs and prepares again.
                _re_sign(ctx, sheet)
            _respond_note(
                ctx.connection, morgan, ctx.organization_id, ctx.project_id, review_id, UUID(str(note_id[0])),
                NoteResponse(version=_version(ctx, "control_reviews", review_id), response=response),
            )  # fmt: skip
            _clear_note(
                ctx.connection, riley, ctx.organization_id, ctx.project_id, review_id, UUID(str(note_id[0])),
                NoteClear(version=_version(ctx, "control_reviews", review_id), action="CLEAR", reason="Addressed on the workpaper."),
            )  # fmt: skip
        # The re-performance, prepared with the demo: the reviewer's checks of the sheet.
        ctx.cursor.execute(
            "UPDATE control_reviews SET reperform_status = 'WORKING', version = version + 1 WHERE id = %s",
            (review_id,),
        )
        _finish(
            ctx.connection, review_id, _version(ctx, "test_sheets", sheet.sheet_id), SEEDED,
            "Prepared with the demo (simulated): the reviewer's re-performance of the sampled items against the approved criteria.",
            None, [],
        )  # fmt: skip
        if ref in REVIEW_SIGNED:
            try:
                _sign_off(
                    ctx.connection, riley, ctx.organization_id, ctx.project_id, review_id,
                    SignOffBody(version=_version(ctx, "control_reviews", review_id), note="Reviewed the sample, the results and the workpaper against the approved plan; conclusion stands."),
                )  # fmt: skip
                signed += 1
            except Exception as error:  # noqa: BLE001 - a review that cannot close stays pending
                logger.info("review for %s stays pending: %s", ref, error)
    ctx.summary["reviews_signed"] = signed
    ctx.summary["review_notes"] = notes


def _re_sign(ctx: Context, sheet: Sheet) -> None:
    """After a must-fix note reopened the sheet and the workpaper: the tester signs the
    sheet again and prepares the workpaper again (the deficiency already logged stands)."""
    from ai_workforce_api.test_sheets import SignOffBody, change_sheet, sign_off_work
    from ai_workforce_api.workpaper_service import PrepareBody, _prepare

    status = ctx.cursor.execute(
        "SELECT status FROM test_sheets WHERE id = %s", (sheet.sheet_id,)
    ).fetchone()
    if status is not None and str(status[0]) == "OPEN":
        change_sheet(
            ctx.connection, ctx.principal("morgan"), ctx.organization_id, ctx.project_id, sheet.sheet_id,
            sign_off_work(SignOffBody(version=_version(ctx, "test_sheets", sheet.sheet_id), note="Citations completed as the reviewer asked; conclusion unchanged.")),
        )  # fmt: skip
    row = ctx.cursor.execute(
        "SELECT id, status FROM workpapers WHERE engagement_control_id = %s AND stage = 'EFFECTIVENESS'",
        (sheet.control_id,),
    ).fetchone()
    if row is not None and str(row[1]) == "DRAFT":
        _prepare(
            ctx.connection, ctx.principal("morgan"), ctx.organization_id, ctx.project_id, UUID(str(row[0])),
            PrepareBody(version=_version(ctx, "workpapers", UUID(str(row[0]))), note="Revised after the reviewer's note."),
        )  # fmt: skip


# Deficiencies and remediation


def _deficiencies(ctx: Context, sheets: dict[str, Sheet]) -> None:
    """The two remediation scenarios: the reviewer's severity decision, management's
    response, the remediation evidence received. Ready-for-retest and the retest itself
    wait for the real clock (the remediation dates are in FY2027)."""
    from ai_workforce_api.evidence_receipts import apply_receipt
    from ai_workforce_api.workspace import (
        ChangeDecision,
        DeficiencyProgress,
        DeficiencyUpdate,
        _decide,
        _progress,
        _update,
    )

    remediated = 0
    for ref in REMEDIATED:
        sheet = sheets.get(ref)
        if sheet is None:
            continue
        row = ctx.cursor.execute(
            """
            SELECT d.id, d.version, d.title, d.condition, d.criteria, d.cause, d.effect, d.pending_change IS NOT NULL,
                   d.remediation_request_id
            FROM deficiencies d WHERE d.project_id = %s AND d.engagement_control_id = %s ORDER BY d.identified_at LIMIT 1
            """,
            (ctx.project_id, sheet.control_id),
        ).fetchone()
        if row is None:
            continue
        deficiency_id = UUID(str(row[0]))
        if row[7]:
            # The reviewer evaluates the severity the lead proposed.
            _decide(
                ctx.connection, ctx.principal("riley"), ctx.organization_id, ctx.project_id, deficiency_id,
                ChangeDecision(version=_version(ctx, "deficiencies", deficiency_id), approve=True, reason="A key control over financial system access with two exceptions in 25: the severity is right."),
            )  # fmt: skip
        plan = _REMEDIATION[ref]
        _update(
            ctx.connection, ctx.principal("dana"), ctx.organization_id, ctx.project_id, deficiency_id,
            DeficiencyUpdate(
                version=_version(ctx, "deficiencies", deficiency_id), title=str(row[2]),
                condition=str(row[3]), criteria=str(row[4]), cause=plan["cause"], effect=str(row[6]) or plan["effect"],
                deficiency_type="OPERATING", likelihood="REASONABLY_POSSIBLE", magnitude="MORE_THAN_INCONSEQUENTIAL",
                compensating_controls=plan["compensating"], remediation_owner=plan["owner"],
                remediation_plan=plan["plan"], remediation_due=plan["due"],
            ),
        )  # fmt: skip
        _progress(
            ctx.connection, ctx.principal("dana"), ctx.organization_id, ctx.project_id, deficiency_id,
            DeficiencyProgress(version=_version(ctx, "deficiencies", deficiency_id), status="REMEDIATION_IN_PROGRESS"),
        )  # fmt: skip
        request_id = row[8]
        if request_id is not None:
            file_id, match_id = _store_remediation_file(
                ctx, ref, sheet.control_id, UUID(str(request_id)), plan
            )
            apply_receipt(
                ctx.cursor,
                ctx.organization_id,
                ctx.project_id,
                match_id,
                UUID(str(request_id)),
                ctx.team["morgan"],
                "PERSON",
            )
            _ = file_id
        remediated += 1
    ctx.summary["remediations"] = remediated


_REMEDIATION: dict[str, dict[str, Any]] = {
    "NS-AC-02": {
        "cause": "The Workday feed reached the SAP security mailbox, but removals were worked from the mailbox by hand; one notification was missed and one was actioned late during a period of absence.",
        "effect": "A terminated employee retained SAP access for nine business days, and another account remained active at the period end.",
        "compensating": "Quarterly access certification (NS-AC-04) and SSO: both users' Entra ID accounts were disabled on the termination date, so no sign-in was possible.",
        "owner": "Priya Raman, Director, SAP Basis & Security",
        "plan": "Automate the lock from the Workday feed through the identity platform (Entra ID lifecycle workflow to SAP), with a daily exception report of terminations not locked within one business day reviewed by the SAP security analyst; lock NSUSR0533 immediately.",
        "due": date(2027, 10, 31),
        "memo_title": "Remediation memo: SAP termination lock automation",
        "memo": [
            "Prepared by Priya Raman, Director, SAP Basis & Security, for the FY2027 IT SOX audit team.",
            "Finding: two of 25 sampled terminations were not locked within three business days (NS-EMP-0417, NS-EMP-0533).",
            "Action taken: NSUSR0533 locked on 2027-10-04 (lock status 64, validity ended). The Workday-to-SAP lock is now automated through the Entra ID lifecycle workflow (change CHG0027231, in production 2027-10-18). A daily exception report lists any termination not locked within one business day; the SAP security analyst reviews it each morning.",
            "Evidence attached on request: the workflow configuration, the exception report for 18 to 31 October 2027, and the lock record for NSUSR0533.",
        ],
    },
    "NS-CM-01": {
        "cause": "The emergency change procedure allowed import before the change manager's approval was recorded on the ticket, and the CAB ratification step was not tracked.",
        "effect": "One transport reached production with no approval on record and no test evidence; another was imported before the CAB approved it.",
        "compensating": "Transports are imported by Basis only (developer and importer always differ); post-implementation review of emergency changes at the next CAB.",
        "owner": "Marcus Delgado, Change & Release Manager",
        "plan": "ServiceNow now blocks the transport import task until the approval date is recorded on the ticket, for normal and emergency changes alike; emergency changes carry a ratification task due at the next CAB; CHG0027144 ratified retrospectively with test evidence attached.",
        "due": date(2027, 11, 15),
        "memo_title": "Remediation memo: change approval before production import",
        "memo": [
            "Prepared by Marcus Delgado, Change & Release Manager, for the FY2027 IT SOX audit team.",
            "Finding: transport TRN-27-0712 (CHG0027144, emergency) was imported on 2027-08-23 with no approval recorded and no test evidence; TRN-27-0655 (CHG0027131) was imported on 2027-07-17, two days before the CAB approval of 2027-07-19.",
            "Action taken: the ServiceNow change workflow was changed (CHG0027240, in production 2027-10-25) so that the Basis import task cannot be assigned until an approval date and approver are recorded; emergency changes now create a ratification task due at the next CAB meeting. CHG0027144 was ratified at the CAB of 2027-10-04 with the test evidence attached.",
            "Evidence attached on request: the workflow change record, the CAB minutes of 2027-10-04, and the import log for 25 October to 7 November 2027 showing approval dates on or before every import.",
        ],
    },
}


def _store_remediation_file(
    ctx: Context, ref: str, control_id: UUID, request_id: UUID, plan: dict[str, Any]
) -> tuple[UUID, UUID]:
    """The management response, as a document filed to the remediation request."""
    from ai_workforce_api.evidence_analysis import _context
    from ai_workforce_api.evidence_classify import rules_classify
    from ai_workforce_api.evidence_extraction import extract
    from ai_workforce_api.storage import open_store

    content = F.docx_bytes(
        plan["memo_title"],
        plan["memo"],
        [],
        [f"Remediation owner: {plan['owner']}. Target date: {plan['due'].isoformat()}."],
    )
    name = f"Remediation_Memo_{ref}_2027-10.docx"
    file_id = uuid5(NAMESPACE, f"{ctx.project_id}:remediation:{ref}")
    key = f"evidence/{file_id}"
    store = open_store(ctx.settings, ctx.connection)
    sha256 = store.put(key, content)
    ctx.cursor.execute(
        """
        INSERT INTO evidence_files (
            id, organization_id, project_id, object_key, content_sha256, size_bytes, content_type,
            file_name, stored_by, source, folder_path, upload_batch_id
        )
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, 'UPLOAD', %s, %s)
        """,
        (
            file_id,
            ctx.organization_id,
            ctx.project_id,
            key,
            sha256,
            len(content),
            F.DOCX_TYPE,
            name,
            ctx.team["morgan"],
            f"Remediation/{ref}",
            uuid5(NAMESPACE, f"{ctx.project_id}:remediation"),
        ),
    )
    ctx.cursor.execute(
        """
        INSERT INTO evidence_matches (organization_id, project_id, evidence_file_id, status, engagement_control_id,
                                      pbc_request_id, filed_by, decided_by, reason)
        VALUES (%s, %s, %s, 'FILED', %s, %s, 'PERSON', %s, %s)
        RETURNING id
        """,
        (
            ctx.organization_id,
            ctx.project_id,
            file_id,
            control_id,
            request_id,
            ctx.team["morgan"],
            "Management's remediation memo, received against the remediation request (prepared with the demo)",
        ),
    )
    match = ctx.cursor.fetchone()
    assert match is not None
    extraction = extract(content, name, F.DOCX_TYPE)
    classification = rules_classify(
        _context(ctx.connection, ctx.project_id, name, extraction, None)
    )
    ctx.cursor.execute(
        """
        INSERT INTO evidence_analyses (organization_id, project_id, evidence_file_id, requested_by_user_id, status, attempts,
                                       extraction, extraction_status, extracted_text, text_truncated, content_redacted,
                                       page_count, row_count, columns, classification, source, note)
        VALUES (%s, %s, %s, %s, 'READY', 1, %s, %s, %s, %s, %s, %s, %s, %s, %s, 'RULES', %s)
        """,
        (
            ctx.organization_id,
            ctx.project_id,
            file_id,
            ctx.team["morgan"],
            extraction.method,
            extraction.status,
            extraction.text,
            extraction.truncated,
            extraction.redacted,
            extraction.pages,
            extraction.rows,
            Json(list(extraction.columns)),
            Json(classification.model_dump()),
            "Read when the demo was prepared.",
        ),
    )
    _audit(
        ctx,
        "evidence.uploaded",
        "evidence_file",
        file_id,
        ctx.team["morgan"],
        {"file_name": name, "seeded": True, "control_ref": ref},
    )
    return file_id, UUID(str(match[0]))


# Helpers


def _version(ctx: Context, table: str, row_id: UUID) -> int:
    row = ctx.cursor.execute(f"SELECT version FROM {table} WHERE id = %s", (row_id,)).fetchone()  # noqa: S608 - table names are literals above
    assert row is not None, (table, row_id)
    return int(row[0])


def _sha(ctx: Context, key: str, ref: str) -> str:
    row = ctx.cursor.execute(
        "SELECT content_sha256 FROM evidence_files WHERE id = %s", (ctx.file_id(key, ref),)
    ).fetchone()
    assert row is not None
    return str(row[0])


def _audit(
    ctx: Context,
    action: str,
    target_type: str,
    target_id: UUID,
    actor: UUID,
    payload: dict[str, Any],
) -> None:
    ctx.cursor.execute(
        """
        INSERT INTO audit_events (organization_id, project_id, actor_user_id, action, target_type, target_id, payload)
        VALUES (%s, %s, %s, %s, %s, %s, %s)
        """,
        (ctx.organization_id, ctx.project_id, actor, action, target_type, target_id, Json(payload)),
    )
