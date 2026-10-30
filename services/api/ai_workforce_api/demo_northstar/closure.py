"""The Northstar lifecycle's closure (Step 4B closure items): the scenario clock and the
schedule it sets, the design evidence, the evidence left open on purpose, the
roll-forward of one effective control, the two remediation retests to a final
conclusion, the reporting deliverables, and the acceptance checks a demo must pass
before it is shown as ready.

Everything goes through the application's services, as the lifecycle does; the scenario
date (scenario.py, migration 0131) is the only date the workflow reads differently for a
demo engagement, and only where it compares a date with today.
"""

# ruff: noqa: E501  (the memos and notes read as sentences)
from __future__ import annotations

import dataclasses
import logging
from datetime import UTC, date, datetime
from typing import Any
from uuid import UUID, uuid5

from psycopg.types.json import Json

from ai_workforce_api.demo_northstar import files as F
from ai_workforce_api.demo_northstar import records as R
from ai_workforce_api.demo_northstar import rounds as RD
from ai_workforce_api.demo_northstar.lifecycle import (
    SEEDED,
    Context,
    Sheet,
    _audit,
    _request_of,
    _results_for_files,
    _seed_containing,
    _version,
)

logger = logging.getLogger(__name__)

NAMESPACE = UUID("c3d9b5e1-7f20-4a8c-8d1e-6b2f0a9c4e55")
# Controls whose remaining interim evidence stays open on purpose: the stale MFA export,
# the unticketed failed load's incident, the firefighter session logs.
OPEN_BY_DESIGN: tuple[str, ...] = ("NS-AC-06", "NS-OP-02", "NS-AC-03")
ROLLFORWARD_CONTROL = "NS-AC-01"
RETESTS: dict[str, dict[str, Any]] = {
    "NS-AC-02": {
        "fixed_on": RD.TERMINATION_FIX_ON,
        "population": "rt_hr_terminations_q4",
        "evidence": ("rt_sap_users_1130", "rt_termination_removals_q4"),
        "aliases": {
            "rt_hr_terminations_q4": "hr_terminations",
            "rt_sap_users_1130": "sap_users",
            "rt_termination_removals_q4": "termination_removals",
        },
        "close_reason": "Retest of 25 terminations after the automated lock went live: every account locked within one business day; the deficiency is remediated.",
    },
    "NS-CM-01": {
        "fixed_on": RD.CHANGE_FIX_ON,
        "population": "rt_transport_log_q4",
        "evidence": ("rt_change_tickets_q4", "rt_cab_approvals_q4"),
        "aliases": {
            "rt_transport_log_q4": "transport_log",
            "rt_change_tickets_q4": "change_tickets",
            "rt_cab_approvals_q4": "cab_approvals",
        },
        "close_reason": "Retest of 25 imports after the workflow change: every transport carries an approval dated on or before its import and test evidence; the deficiency is remediated.",
    },
}
REPORTS: tuple[tuple[str, str], ...] = (
    ("status_report", "pdf"),
    ("executive_summary", "docx"),
    ("exceptions_report", "pdf"),
    ("control_summary", "docx"),
)
REPORT_NARRATIVE = (
    "Interim status as of 15 December 2027 for the Northstar Technologies, Inc. FY2027 IT SOX "
    "audit (synthetic demonstration engagement; simulated). Draft: interim testing is complete "
    "for 13 of 14 controls, two deficiencies were remediated and retested with the reviewer's "
    "approval, four deficiencies remain open, three reviews are pending, one control waits for "
    "a dated configuration export, and roll-forward testing to 31 December 2027 is under way. "
    "This is not a final report."
)


def run_closure(ctx: Context, sheets: dict[str, Sheet]) -> dict[str, Any]:
    rounds = RD.build(ctx.data)
    round_files = {item.key: item for item in RD.render(rounds)}
    out: dict[str, Any] = {}
    _scenario_clock(ctx)
    out["design_evidence"] = _design_evidence(ctx)
    out["requirements_completed"] = _complete_requirements(ctx)
    out["rollforward"] = _rollforward(ctx, rounds, round_files, sheets)
    out["retests"] = {ref: _retest(ctx, ref, rounds, round_files) for ref in RETESTS}
    out["reports"] = _reports(ctx)
    problems = acceptance(ctx)
    out["acceptance"] = problems
    if problems:
        raise ValueError("demo acceptance failed: " + "; ".join(problems))
    return out


# The scenario clock


def _scenario_clock(ctx: Context) -> None:
    """The engagement's kickoff and schedule in the scenario's year, and the scenario
    date the workflow reads for this demo engagement alone."""
    from ai_workforce_api.workspace import create_engagement_schedule

    kickoff = datetime.combine(RD.SCENARIO_KICKOFF, datetime.min.time(), tzinfo=UTC)
    ctx.cursor.execute(
        """
        UPDATE engagement_settings
        SET kicked_off_at = %s, scenario_as_of = %s, version = version + 1, updated_at = clock_timestamp()
        WHERE project_id = %s
        """,
        (kickoff, RD.SCENARIO_AS_OF, ctx.project_id),
    )
    ctx.cursor.execute("DELETE FROM engagement_milestones WHERE project_id = %s", (ctx.project_id,))
    ctx.cursor.execute("DELETE FROM engagement_phases WHERE project_id = %s", (ctx.project_id,))
    create_engagement_schedule(
        ctx.cursor, ctx.organization_id, ctx.project_id, RD.SCENARIO_KICKOFF, R.PERIOD_END, 10
    )
    # Walkthroughs and interim testing are done in the scenario; the records say when.
    ctx.cursor.execute(
        """
        UPDATE engagement_milestones
        SET completed_at = due_date::timestamptz, completed_by = %s, version = version + 1
        WHERE project_id = %s AND completed_at IS NULL
          AND milestone_key IN ('PBC_DUE', 'WALKTHROUGHS_COMPLETE', 'INTERIM_CUTOFF', 'INTERIM_TESTING_COMPLETE')
        """,
        (ctx.team["dana"], ctx.project_id),
    )
    _audit(
        ctx,
        "demo.scenario_clock",
        "project",
        ctx.project_id,
        ctx.team["dana"],
        {
            "scenario_as_of": RD.SCENARIO_AS_OF.isoformat(),
            "kickoff": RD.SCENARIO_KICKOFF.isoformat(),
            "simulated": True,
        },
    )


# Evidence


def _store(
    ctx: Context,
    item: F.EvidenceFile,
    control_id: UUID,
    request_id: UUID | None,
    requirement_id: UUID | None,
    folder: str,
) -> tuple[UUID, UUID]:
    """A file stored, filed to its control (and request), read by the pipeline."""
    from ai_workforce_api.evidence_analysis import _context
    from ai_workforce_api.evidence_classify import rules_classify
    from ai_workforce_api.evidence_extraction import extract
    from ai_workforce_api.storage import open_store

    store = open_store(ctx.settings, ctx.connection)
    file_id = uuid5(NAMESPACE, f"{ctx.project_id}:{item.key}:{control_id}")
    key = f"evidence/{file_id}"
    sha256 = store.put(key, item.content)
    ctx.cursor.execute(
        """
        INSERT INTO evidence_files (id, organization_id, project_id, object_key, content_sha256, size_bytes,
                                    content_type, file_name, stored_by, source, folder_path, upload_batch_id)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, 'UPLOAD', %s, %s)
        """,
        (
            file_id,
            ctx.organization_id,
            ctx.project_id,
            key,
            sha256,
            item.size,
            item.content_type,
            item.file_name,
            ctx.team["morgan"],
            folder,
            uuid5(NAMESPACE, f"{ctx.project_id}:closure"),
        ),
    )
    ctx.cursor.execute(
        """
        INSERT INTO evidence_matches (organization_id, project_id, evidence_file_id, status, engagement_control_id,
                                      pbc_request_id, requirement_id, filed_by, decided_by, reason)
        VALUES (%s, %s, %s, 'FILED', %s, %s, %s, 'PERSON', %s, %s)
        RETURNING id
        """,
        (
            ctx.organization_id,
            ctx.project_id,
            file_id,
            control_id,
            request_id,
            requirement_id if request_id else None,
            ctx.team["morgan"],
            f"Prepared with the demo: {item.description}"[:500],
        ),
    )
    match = ctx.cursor.fetchone()
    assert match is not None
    extraction = extract(item.content, item.file_name, item.content_type)
    classification = rules_classify(
        _context(ctx.connection, ctx.project_id, item.file_name, extraction, None)
    )
    payload = classification.model_dump()
    if requirement_id is not None:
        payload["items"] = [
            {
                "index": 0,
                "title": item.description[:220],
                "requirement_id": str(requirement_id),
                "coverage": "COVERED",
                "note": "Prepared with the demo: the file is the item requested.",
            }
        ]
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
            Json(payload),
            "Read when the demo was prepared.",
        ),
    )
    ctx.texts[item.key] = extraction.text
    _audit(
        ctx,
        "evidence.uploaded",
        "evidence_file",
        file_id,
        ctx.team["morgan"],
        {"file_name": item.file_name, "seeded": True},
    )
    return file_id, UUID(str(match[0]))


def _accept(ctx: Context, control_id: UUID, requirement_id: UUID, note: str) -> None:
    from ai_workforce_api.evidence_plans import SufficiencyBody, set_sufficiency

    version = _version(ctx, "evidence_requirements", requirement_id)
    set_sufficiency(
        ctx.connection,
        ctx.organization_id,
        ctx.project_id,
        control_id,
        requirement_id,
        ctx.team["morgan"],
        SufficiencyBody(sufficiency="ACCEPTED", note=note[:1000], version=version),
    )


def _link(ctx: Context, control_id: UUID, requirement_id: UUID, file_id: UUID, reason: str) -> bool:
    from ai_workforce_api.evidence_plans import LinkBody, link_file

    try:
        link_file(
            ctx.connection,
            ctx.organization_id,
            ctx.project_id,
            control_id,
            requirement_id,
            ctx.team["morgan"],
            LinkBody(
                file_id=file_id,
                reason=reason[:500],
                version=_version(ctx, "evidence_requirements", requirement_id),
            ),
        )
    except Exception as error:  # noqa: BLE001 - a file already serving the item is fine
        logger.info("link skipped: %s", error)
        return False
    return True


def _design_evidence(ctx: Context) -> int:
    """A walkthrough memo per control on its design request, accepted by the tester: the
    design assessments the workpapers record rest on evidence."""
    from ai_workforce_api.evidence_receipts import apply_receipt

    accepted = 0
    for control in R.CONTROLS:
        control_id = ctx.controls[control.ref]
        request = _request_of(ctx, control_id, "DESIGN")
        if request is None:
            continue
        requirements = ctx.cursor.execute(
            "SELECT id, title FROM evidence_requirements WHERE pbc_request_id = %s AND status = 'REQUESTED' ORDER BY code",
            (request,),
        ).fetchall()
        if not requirements:
            continue
        owner = R.PEOPLE[control.owner]
        walkthrough = date(2027, 4, 12) + (R.CONTROLS.index(control) % 6) * (
            date(2027, 4, 19) - date(2027, 4, 12)
        )
        memo = F.docx_bytes(
            f"Design walkthrough: {control.ref} {control.name}",
            [
                f"Walkthrough held on {walkthrough.isoformat()} with {owner.name}, {owner.title}, by Dana Whitfield and Morgan Lee (audit team).",
                f"Control objective: {control.objective}",
                f"Risk addressed: {control.risk}",
                f"How the control operates: {control.description}",
                f"Systems: {', '.join(R.SYSTEM_BY_KEY[k].name for k in control.systems)}. Frequency: {control.frequency.replace('_', ' ').lower()}. Nature: {control.nature.replace('_', ' ').lower()}.",
                "Design conclusion: the control, as described and walked through, addresses the risk when it operates as designed; the attributes below are the points the operating test examines.",
            ],
            [
                (
                    "Attributes examined",
                    (("attribute", "Attribute"),),
                    [{"attribute": a} for a in control.attributes],
                )
            ],
            ["Prepared with the Northstar demo dataset (simulated)."],
        )
        item = F.EvidenceFile(
            f"design_{control.ref.lower()}",
            f"Design_Walkthrough_{control.ref}.docx",
            F.DOCX_TYPE,
            memo,
            (control.ref,),
            control.systems[0],
            "Design/Walkthroughs",
            f"Design walkthrough memo for {control.ref}",
        )
        first_id = UUID(str(requirements[0][0]))
        file_id, match_id = _store(ctx, item, control_id, request, first_id, item.folder)
        apply_receipt(
            ctx.cursor,
            ctx.organization_id,
            ctx.project_id,
            match_id,
            request,
            ctx.team["morgan"],
            "PERSON",
        )
        for requirement_id, title in requirements:
            rid = UUID(str(requirement_id))
            if rid != first_id:
                _link(
                    ctx,
                    control_id,
                    rid,
                    file_id,
                    f"The walkthrough memo also documents {str(title)[:80]}.",
                )
            _accept(
                ctx,
                control_id,
                rid,
                f"Design evidenced by the walkthrough of {walkthrough.isoformat()} with the control owner.",
            )
            accepted += 1
    return accepted


def _complete_requirements(ctx: Context) -> dict[str, int]:
    """Interim items still waiting: served by the control's own files and accepted, except
    on the controls kept open on purpose. Roll-forward items wait for their phase."""
    counts = {"accepted": 0, "open_by_design": 0, "future_phase": 0}
    for control in R.CONTROLS:
        control_id = ctx.controls[control.ref]
        rows = ctx.cursor.execute(
            """
            SELECT q.id, q.title, q.phase, r.id
            FROM evidence_requirements q JOIN pbc_requests r ON r.id = q.pbc_request_id
            WHERE r.project_id = %s AND r.engagement_control_id = %s
              AND q.status = 'REQUESTED' AND q.sufficiency = 'NOT_REVIEWED'
            ORDER BY q.phase, q.code
            """,
            (ctx.project_id, control_id),
        ).fetchall()
        files = [fid for (key, ref), fid in ctx.filed.items() if ref == control.ref][:2]
        for requirement_id, title, phase, _request in rows:
            if phase == "ROLLFORWARD":
                counts["future_phase"] += 1
                continue
            if control.ref in OPEN_BY_DESIGN:
                counts["open_by_design"] += 1
                continue
            rid = UUID(str(requirement_id))
            linked = any(
                _link(
                    ctx,
                    control_id,
                    rid,
                    fid,
                    f"Serves {str(title)[:80]} from the evidence provided for the interim.",
                )
                for fid in files
            )
            if linked:
                _accept(
                    ctx,
                    control_id,
                    rid,
                    f"Served by the control's interim evidence: {str(title)[:100]}.",
                )
                counts["accepted"] += 1
            else:
                counts["open_by_design"] += 1
    return counts


# Rounds


def _round(
    ctx: Context, control_id: UUID, kind: str
) -> tuple[UUID, UUID | None, int, date, date] | None:
    row = ctx.cursor.execute(
        """
        SELECT id, request_id, sample_size, window_start, window_end FROM test_rounds
        WHERE project_id = %s AND engagement_control_id = %s AND kind = %s AND status IN ('REQUESTED', 'TESTING')
        ORDER BY number DESC LIMIT 1
        """,
        (ctx.project_id, control_id, kind),
    ).fetchone()
    if row is None:
        return None
    return UUID(str(row[0])), UUID(str(row[1])) if row[1] else None, int(row[2]), row[3], row[4]


def _test_round(
    ctx: Context,
    control: R.Control,
    round_id: UUID,
    request_id: UUID | None,
    size: int,
    window: tuple[date, date],
    population_key: str,
    evidence_keys: tuple[str, ...],
    aliases: dict[str, str],
    round_files: dict[str, F.EvidenceFile],
    data: R.Records,
    required: tuple[str, ...],
    folder: str,
) -> Sheet:
    """A round tested end to end: its population received on the round's request, the
    sample drawn inside the window, the sheet, the results cited from the round's files,
    the tester's sign-off and the independent review."""
    from ai_workforce_api import sampling
    from ai_workforce_api.control_tests import (
        VersionBody,
        _approve,
        control_for_population,
        propose,
    )
    from ai_workforce_api.evidence_extraction import read_table
    from ai_workforce_api.evidence_receipts import apply_receipt

    control_id = ctx.controls[control.ref]
    stored: list[tuple[str, F.EvidenceFile, UUID]] = []
    population = round_files[population_key]
    file_id, match_id = _store(ctx, population, control_id, request_id, None, folder)
    if request_id is not None:
        apply_receipt(
            ctx.cursor,
            ctx.organization_id,
            ctx.project_id,
            match_id,
            request_id,
            ctx.team["morgan"],
            "PERSON",
        )
    stored.append((aliases[population_key], population, file_id))
    for key in evidence_keys:
        fid, _ = _store(ctx, round_files[key], control_id, None, None, folder)
        stored.append((aliases[key], round_files[key], fid))
    # A roll-forward's population gate: the phase's population item, served and accepted.
    for requirement_id, categories in ctx.cursor.execute(
        """
        SELECT q.id, q.categories FROM evidence_requirements q JOIN pbc_requests r ON r.id = q.pbc_request_id
        WHERE r.project_id = %s AND r.engagement_control_id = %s AND q.phase = 'ROLLFORWARD'
          AND q.status NOT IN ('WAIVED', 'REMOVED') AND q.sufficiency <> 'ACCEPTED'
        """,
        (ctx.project_id, control_id),
    ).fetchall():
        if "POPULATION" in (categories or []) or "REPORT_RELIABILITY" in (categories or []):
            rid = UUID(str(requirement_id))
            # On the round's own request the file already serves the item (the link is
            # refused for that reason); elsewhere it is linked first. The tester accepts it.
            _link(
                ctx,
                control_id,
                rid,
                file_id,
                "The roll-forward population, 1 October to 10 December 2027.",
            )
            try:
                _accept(ctx, control_id, rid, "Roll-forward population received and read.")
            except Exception as error:  # noqa: BLE001 - an item the file cannot serve stays as it is
                logger.info("roll-forward item not accepted: %s", error)
    table = read_table(population.content, population.file_name, population.content_type)
    facts = control_for_population(ctx.connection, ctx.project_id, control_id)
    assert table is not None and facts is not None, control.ref
    period_end, frequency, nature, _size, tester = facts
    frame = sampling.build_frame(table, period_end, frequency, window=window)
    seed = _seed_containing(table, frame, size, required)
    test_id = propose(
        ctx.cursor,
        organization_id=ctx.organization_id,
        project_id=ctx.project_id,
        control_id=control_id,
        file_id=file_id,
        file_name=population.file_name,
        sha256=_sha_of(ctx, file_id),
        table=table,
        period_end=period_end,
        frequency=frequency,
        nature=nature,
        size=size,
        proposer=ctx.team["morgan"],
        tester=tester,
        seed=seed,
        test_round_id=round_id,
        window=window,
    )
    assert test_id is not None, control.ref
    _approve(
        ctx.connection,
        ctx.principal("dana"),
        ctx.organization_id,
        ctx.project_id,
        test_id,
        VersionBody(version=_version(ctx, "control_tests", test_id)),
    )
    row = ctx.cursor.execute(
        "SELECT id FROM test_sheets WHERE test_round_id = %s", (round_id,)
    ).fetchone()
    assert row is not None
    sheet_id = UUID(str(row[0]))
    ctx.cursor.execute(
        "UPDATE test_sheets SET run_status = 'IDLE', version = version + 1 WHERE id = %s",
        (sheet_id,),
    )
    round_ctx = dataclasses.replace(
        ctx,
        data=data,
        texts={**ctx.texts, **{alias: ctx.texts[item.key] for alias, item, _ in stored}},
    )
    exceptions = _results_for_files(
        round_ctx,
        control,
        sheet_id,
        [(alias, fid) for alias, _, fid in stored],
        aliases[population_key],
        {alias: item for alias, item, _ in stored},
    )
    sheet = Sheet(control.ref, control_id, sheet_id, "", 0, exceptions)
    _sign_round(ctx, sheet, round_id)
    return sheet


def _sha_of(ctx: Context, file_id: UUID) -> str:
    row = ctx.cursor.execute(
        "SELECT content_sha256 FROM evidence_files WHERE id = %s", (file_id,)
    ).fetchone()
    assert row is not None
    return str(row[0])


def _sign_round(ctx: Context, sheet: Sheet, round_id: UUID) -> None:
    from ai_workforce_api.control_reviews import SignOffBody as ReviewSignOff
    from ai_workforce_api.control_reviews import _finish, _sign_off
    from ai_workforce_api.test_sheets import SignOffBody, change_sheet, sign_off_work

    body, _ = change_sheet(
        ctx.connection,
        ctx.principal("morgan"),
        ctx.organization_id,
        ctx.project_id,
        sheet.sheet_id,
        sign_off_work(
            SignOffBody(
                version=_version(ctx, "test_sheets", sheet.sheet_id),
                note="Round tested from the evidence the control owner provided after the period of the fix (prepared with the demo, simulated).",
            )
        ),
    )
    sheet.conclusion = str(body.conclusion or "")
    review = ctx.cursor.execute(
        "SELECT id FROM control_reviews WHERE test_round_id = %s", (round_id,)
    ).fetchone()
    assert review is not None, "the round's review"
    review_id = UUID(str(review[0]))
    ctx.cursor.execute(
        "UPDATE control_reviews SET reperform_status = 'WORKING', version = version + 1 WHERE id = %s",
        (review_id,),
    )
    _finish(
        ctx.connection,
        review_id,
        _version(ctx, "test_sheets", sheet.sheet_id),
        SEEDED,
        "Prepared with the demo (simulated): the reviewer's re-performance of the round's samples.",
        None,
        [],
    )
    _sign_off(
        ctx.connection,
        ctx.principal("riley"),
        ctx.organization_id,
        ctx.project_id,
        review_id,
        ReviewSignOff(
            version=_version(ctx, "control_reviews", review_id),
            note="Round reviewed against the approved plan and the round's evidence; conclusion stands.",
        ),
    )


def _rollforward(
    ctx: Context,
    rounds: RD.RoundRecords,
    round_files: dict[str, F.EvidenceFile],
    sheets: dict[str, Sheet],
) -> dict[str, Any]:
    control = R.CONTROL_BY_REF[ROLLFORWARD_CONTROL]
    found = _round(ctx, ctx.controls[control.ref], "ROLLFORWARD")
    if found is None:
        return {"skipped": "no roll-forward round"}
    round_id, request_id, size, start, end = found
    data = dataclasses.replace(ctx.data, access_requests=rounds.access_requests_q4)
    sheet = _test_round(
        ctx,
        control,
        round_id,
        request_id,
        size,
        (start, end),
        "rf_access_requests_q4",
        (),
        {"rf_access_requests_q4": "access_requests"},
        round_files,
        data,
        (),
        "Access/Provisioning/Roll-forward",
    )
    return {"round": str(round_id), "conclusion": sheet.conclusion}


def _retest(
    ctx: Context, ref: str, rounds: RD.RoundRecords, round_files: dict[str, F.EvidenceFile]
) -> dict[str, Any]:
    """Management says the fix took effect; the retest round opens, its evidence arrives,
    the round is tested and reviewed; the deficiency is remediated and then closed by
    the lead's request and the reviewer's decision."""
    from ai_workforce_api.workspace import (
        ChangeDecision,
        ChangeRequest,
        DeficiencyProgress,
        _decide,
        _progress,
        _request_change,
    )

    spec = RETESTS[ref]
    control = R.CONTROL_BY_REF[ref]
    control_id = ctx.controls[ref]
    row = ctx.cursor.execute(
        "SELECT id FROM deficiencies WHERE project_id = %s AND engagement_control_id = %s ORDER BY identified_at LIMIT 1",
        (ctx.project_id, control_id),
    ).fetchone()
    assert row is not None, ref
    deficiency_id = UUID(str(row[0]))
    _progress(
        ctx.connection,
        ctx.principal("dana"),
        ctx.organization_id,
        ctx.project_id,
        deficiency_id,
        DeficiencyProgress(
            version=_version(ctx, "deficiencies", deficiency_id),
            status="READY_FOR_RETEST",
            remediated_on=spec["fixed_on"],
        ),
    )
    found = _round(ctx, control_id, "RETEST")
    assert found is not None, ref
    round_id, request_id, size, start, end = found
    if ref == "NS-AC-02":
        data = dataclasses.replace(
            ctx.data,
            hr_terminations=rounds.hr_terminations_q4,
            termination_removals=rounds.termination_removals_q4,
            sap_users=rounds.sap_users_1130,
        )
    else:
        data = dataclasses.replace(
            ctx.data,
            transport_log=rounds.transport_log_q4,
            change_tickets=rounds.change_tickets_q4,
            cab_meetings=rounds.cab_meetings_q4,
        )
    sheet = _test_round(
        ctx,
        control,
        round_id,
        request_id,
        size,
        (start, end),
        spec["population"],
        spec["evidence"],
        spec["aliases"],
        round_files,
        data,
        (),
        f"{'Access/Terminations' if ref == 'NS-AC-02' else 'Change/SAP'}/Retest",
    )
    status = ctx.cursor.execute(
        "SELECT status FROM deficiencies WHERE id = %s", (deficiency_id,)
    ).fetchone()
    assert status is not None
    if str(status[0]) == "REMEDIATED":
        _request_change(
            ctx.connection,
            ctx.principal("dana"),
            ctx.organization_id,
            ctx.project_id,
            deficiency_id,
            ChangeRequest(
                version=_version(ctx, "deficiencies", deficiency_id),
                kind="CLOSE",
                reason=spec["close_reason"],
            ),
        )
        _decide(
            ctx.connection,
            ctx.principal("riley"),
            ctx.organization_id,
            ctx.project_id,
            deficiency_id,
            ChangeDecision(
                version=_version(ctx, "deficiencies", deficiency_id),
                approve=True,
                reason="Retest passed with the round's review signed; closure approved.",
            ),
        )
    final = ctx.cursor.execute(
        "SELECT status, retest_result FROM deficiencies WHERE id = %s", (deficiency_id,)
    ).fetchone()
    assert final is not None
    return {
        "round": str(round_id),
        "conclusion": sheet.conclusion,
        "deficiency": str(final[0]),
        "retest_result": str(final[1]),
    }


# Reports


def _reports(ctx: Context) -> list[str]:
    """The reporting deliverables, from the reporting engine and the records, labelled as
    a draft interim status of a simulated engagement."""
    from ai_workforce_api.exports import create_export

    made: list[str] = []
    for kind, fmt in REPORTS:
        try:
            body = create_export(
                ctx.connection,
                ctx.settings,
                ctx.principal("dana"),
                ctx.organization_id,
                ctx.project_id,
                kind,
                fmt,
                {},
                narrative=REPORT_NARRATIVE,
            )
            made.append(f"{kind}.{fmt}:{body.id}")
        except Exception as error:  # noqa: BLE001 - a report kind the engagement cannot yet fill is reported, not fatal
            logger.info("report %s skipped: %s", kind, error)
    return made


# Acceptance


def acceptance(ctx: Context) -> list[str]:
    """What a demo must show before it is shown as ready. Each failure names itself."""
    problems: list[str] = []
    q = ctx.cursor

    def one(sql: str, *params: Any) -> Any:
        row = q.execute(sql, params).fetchone()
        return None if row is None else row[0]

    if (
        one(
            "SELECT count(*) FROM evidence_plans WHERE project_id = %s AND status = 'APPROVED'",
            ctx.project_id,
        )
        != 14
    ):
        problems.append("not every plan is approved")
    if (
        one(
            "SELECT count(*) FROM test_sheets WHERE project_id = %s AND test_round_id IS NULL AND status = 'SIGNED_OFF'",
            ctx.project_id,
        )
        < 13
    ):
        problems.append("fewer than thirteen interim sheets are signed")
    if (
        one(
            "SELECT count(*) FROM control_reviews WHERE project_id = %s AND status = 'SIGNED_OFF'",
            ctx.project_id,
        )
        < 12
    ):
        problems.append("fewer than twelve reviews are signed")
    if (
        one(
            "SELECT count(*) FROM test_rounds WHERE project_id = %s AND kind = 'RETEST' AND status = 'SIGNED_OFF' AND conclusion = 'EFFECTIVE'",
            ctx.project_id,
        )
        != 2
    ):
        problems.append("the two retests are not signed effective")
    if (
        one(
            "SELECT count(*) FROM test_rounds WHERE project_id = %s AND kind = 'ROLLFORWARD' AND status = 'SIGNED_OFF'",
            ctx.project_id,
        )
        < 1
    ):
        problems.append("no roll-forward round is signed")
    if (
        one(
            "SELECT count(*) FROM deficiencies WHERE project_id = %s AND status = 'CLOSED'",
            ctx.project_id,
        )
        != 2
    ):
        problems.append("the two remediated deficiencies are not closed")
    bad = one(
        """
        SELECT count(*) FROM test_items i JOIN test_sheets s ON s.id = i.test_sheet_id,
             jsonb_array_elements(i.results) r
        WHERE s.project_id = %s AND r->>'result' IN ('PASS', 'EXCEPTION')
          AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(r->'citations') c WHERE (c->>'found')::boolean)
        """,
        ctx.project_id,
    )
    if bad:
        problems.append(f"{bad} results lack a verified citation")
    if one("SELECT count(*) FROM model_calls WHERE project_id = %s", ctx.project_id):
        problems.append("a model was called")
    if one("SELECT count(*) FROM engagement_exports WHERE project_id = %s", ctx.project_id) < 2:
        problems.append("fewer than two reports were produced")
    if (
        one("SELECT scenario_as_of FROM engagement_settings WHERE project_id = %s", ctx.project_id)
        != RD.SCENARIO_AS_OF
    ):
        problems.append("the scenario date is not set")
    return problems
