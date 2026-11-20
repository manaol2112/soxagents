"""The request review states of the PBC draft coverage change (pbc-draft-coverage, FO-28).

A second engagement whose sampled control (ITGC-AC-01) has its population accepted and its
test plan approved, so its sample request is drafted with the selected samples, as
tests/test_request_details.py builds it (test_testing_engine._approved_samples, then the
control test approved over the API). The states:

- pbc-sample-request   the sample request in the Evidence page's request panel: a Redraft
                       is refused (409) with the sentence the API gives
- pbc-phase-request    an operating (INTERIM) phase request of another control: its mapping
                       check names the planned items and the attribute links
- pbc-design-request   a design phase request: its mapping check names the planned items
- pbc-unphased-request a phase request whose testing phase is cleared, as a kickoff draft
                       kept from before planning reads (the API test does the same): a
                       Redraft is refused (409)

After the design review of 19 November 2026 (no Redraft offered where it is always
refused; a draft that was not written says what to do):

- pbc-overfull-request a design request carrying more planned items than one draft holds:
                       the owner adds them over the API (the test plan rewords the request
                       with every item), and the queued draft is run as the worker runs it,
                       so it is not written and a Redraft is not offered
- pbc-replanned-request a design request whose planned items change while it is drafted:
                       one comes off it during the (scripted) model call, as the API
                       test takes it off
- pbc-rejected-request an interim request whose model draft fails the pairing check
                       (one item asks for another artifact), so the rules draft it

The second engagement has its own owner, so each state carries an owner sign-in token
(`token`, 8 hours, like the session file's) for that engagement.
"""

import secrets
from typing import Any
from uuid import UUID

from test_testing_engine import _approved_samples

from ai_workforce_api.auth import token_hash
from ai_workforce_api.db import connect


def _phase_request(
    connection: Any,
    project: UUID,
    phase: str,
    skip: set[UUID],
    ref: str | None = None,
    at_least: int = 1,
    other_than: frozenset[str] = frozenset(),
) -> tuple[UUID, str]:
    row = connection.execute(
        """
        SELECT r.id, c.control_ref FROM pbc_requests r
        JOIN engagement_controls c ON c.id = r.engagement_control_id
        WHERE r.project_id = %s AND r.status = 'DRAFT' AND r.testing_phase = %s
          AND r.id <> ALL(%s::uuid[]) AND (%s::text IS NULL OR c.control_ref = %s)
          AND c.control_ref <> ALL(%s::text[])
          AND (
              SELECT count(*) FROM evidence_requirements e
              WHERE e.pbc_request_id = r.id AND e.status = 'REQUESTED'
          ) >= %s
        ORDER BY c.control_ref, r.created_at
        LIMIT 1
        """,
        (project, phase, list(skip), ref, ref, sorted(other_than), at_least),
    ).fetchone()
    assert row is not None, f"no {phase} draft request with planned evidence"
    return UUID(str(row[0])), str(row[1])


def _redraft(client: Any, team: dict[str, Any], request: UUID) -> UUID:
    """A Redraft asked for over the API: the draft waits for the worker."""
    asked = client.post(
        f"/organizations/{team['org']}/projects/{team['project']}/pbc-requests/{request}/redraft"
    )
    assert asked.status_code == 200, asked.text
    return UUID(asked.json()["id"])


def _unassigned(client: Any, team: dict[str, Any], request: UUID) -> None:
    one = f"/organizations/{team['org']}/projects/{team['project']}/pbc-requests/{request}"
    read = client.get(f"{one}/details")
    assert read.status_code == 200, read.text
    pbc = read.json()["request"]
    cleared = client.post(
        f"{one}/assignment",
        json={
            "version": pbc["version"],
            "recipient": "",
            "cc": [],
            "due_on": str(pbc["due_at"])[:10],
            "priority": pbc.get("priority", "NORMAL"),
        },
    )
    assert cleared.status_code == 200, cleared.text


def _control_of(connection: Any, request: UUID) -> UUID:
    row = connection.execute(
        "SELECT engagement_control_id FROM pbc_requests WHERE id = %s", (request,)
    ).fetchone()
    assert row is not None
    return UUID(str(row[0]))


def _overfull(seed: Any, team: dict[str, Any], client: Any, request: UUID) -> None:
    from ai_workforce_api.pbc_drafting import MAX_ITEMS, TOO_MANY, run_draft

    with connect(seed.database.url) as connection:
        control = _control_of(connection, request)
        carried = connection.execute(
            "SELECT count(*) FROM evidence_requirements "
            "WHERE pbc_request_id = %s AND status = 'REQUESTED'",
            (request,),
        ).fetchone()
    assert carried is not None
    base = f"/organizations/{team['org']}/projects/{team['project']}/controls/{control}"
    for n in range(MAX_ITEMS + 1 - int(carried[0])):
        added = client.post(
            f"{base}/evidence-requirements",
            json={
                "phase": "DESIGN",
                "title": f"Signed approval of access change {n + 1}",
                "description": f"The signed approval of access change {n + 1}, as recorded.",
                "categories": ["CONTROL_EXECUTION"],
                "objective": "Access changes are approved",
                "rationale": "Shows the approval was given before the change was made.",
            },
        )
        assert added.status_code == 200, added.text
    with connect(seed.database.url) as connection:
        held = connection.execute(
            "SELECT count(*) FROM evidence_requirements "
            "WHERE pbc_request_id = %s AND status = 'REQUESTED'",
            (request,),
        ).fetchone()
        assert held is not None and int(held[0]) > MAX_ITEMS, held
        drafts = connection.execute(
            "SELECT id FROM pbc_drafts WHERE pbc_request_id = %s AND status = 'PENDING'",
            (request,),
        ).fetchall()
        assert drafts, "no draft queued for the request"
        for (draft,) in drafts:
            assert run_draft(connection, None, UUID(str(draft))) == "SKIPPED"
        note = connection.execute(
            "SELECT note FROM pbc_drafts WHERE pbc_request_id = %s", (request,)
        ).fetchone()
    assert note is not None and note[0] == TOO_MANY, note


def _replanned(seed: Any, team: dict[str, Any], client: Any, request: UUID) -> None:
    from test_request_details import _asked, _coverage_draft, _planned_of, _ScriptedModel

    from ai_workforce_api.pbc_drafting import REPLANNED, run_draft

    with connect(seed.database.url) as connection:
        control = _control_of(connection, request)
        last = connection.execute(
            "SELECT id FROM evidence_requirements "
            "WHERE pbc_request_id = %s AND status = 'REQUESTED' "
            "ORDER BY created_at DESC, id DESC LIMIT 1",
            (request,),
        ).fetchone()
    assert last is not None
    planned = _planned_of(seed.database, team["project"], control, request)
    assert len(planned) >= 2, planned
    draft = _redraft(client, team, request)

    def replanned() -> None:
        # As the API test does (test_a_plan_change_while_the_request_is_drafted_...): the
        # item comes off the request without its wording changing. A removal over the API
        # rewords the request as well, which the draft reads as a person's rewording.
        with connect(seed.database.url) as other:
            other.execute(
                "UPDATE evidence_requirements SET status = 'REMOVED', version = version + 1 "
                "WHERE id = %s",
                (last[0],),
            )

    model = _ScriptedModel(_coverage_draft(*map(_asked, planned)), during=replanned)
    with connect(seed.database.url) as connection:
        assert run_draft(connection, model, draft) == "SKIPPED"
        note = connection.execute("SELECT note FROM pbc_drafts WHERE id = %s", (draft,)).fetchone()
    assert note is not None and note[0] == REPLANNED, note


def _rejected(seed: Any, team: dict[str, Any], client: Any, request: UUID) -> None:
    from test_request_details import _asked, _coverage_draft, _planned_of, _ScriptedModel

    from ai_workforce_api.pbc_drafting import run_draft

    with connect(seed.database.url) as connection:
        control = _control_of(connection, request)
    planned = _planned_of(seed.database, team["project"], control, request)
    assert planned
    substitute = _asked(
        planned[0],
        title="A second copy of the access policy",
        detail="Another copy of the access policy, as approved.",
    )
    output = _coverage_draft(substitute, *map(_asked, planned[1:]))
    draft = _redraft(client, team, request)
    with connect(seed.database.url) as connection:
        assert run_draft(connection, _ScriptedModel(output), draft) == "DRAFTED"
        row = connection.execute(
            "SELECT source, note FROM pbc_drafts WHERE id = %s", (draft,)
        ).fetchone()
    assert row is not None and row[0] == "FALLBACK", row
    assert str(row[1]).startswith("Model draft rejected: draft item 1 is not planned item 1"), row


def build(seed: Any) -> None:
    team, client, _scheduler, plan = _approved_samples(seed.database, "pbc-coverage")
    approved = client.post(
        f"/organizations/{team['org']}/projects/{team['project']}/control-tests/"
        f"{plan['id']}/approve",
        json={"version": plan["version"]},
    )
    assert approved.status_code == 200, approved.text
    sample = UUID(approved.json()["sample_request_id"])
    token = secrets.token_urlsafe(32)
    with connect(seed.database.url) as connection:
        phase, phase_ref = _phase_request(connection, team["project"], "INTERIM", {sample})
        design, design_ref = _phase_request(connection, team["project"], "DESIGN", set())
        unphased, unphased_ref = _phase_request(
            connection, team["project"], "INTERIM", {sample, phase}
        )
        connection.execute(
            "UPDATE pbc_requests SET testing_phase = NULL WHERE id = %s", (unphased,)
        )
        # Each on a control of its own: adding planned items sends that control's plan
        # back for approval, which holds its other requests.
        used = {sample, phase, design, unphased}
        taken = {str(plan.get("control_ref", "")), phase_ref, design_ref, unphased_ref}
        overfull, overfull_ref = _phase_request(
            connection, team["project"], "DESIGN", used, other_than=frozenset(taken)
        )
        taken.add(overfull_ref)
        replanned, replanned_ref = _phase_request(
            connection, team["project"], "DESIGN", used, at_least=2, other_than=frozenset(taken)
        )
        taken.add(replanned_ref)
        rejected, rejected_ref = _phase_request(
            connection, team["project"], "INTERIM", used, other_than=frozenset(taken)
        )
        connection.execute(
            "UPDATE organizations SET name = 'Example Audit Firm' WHERE id = %s", (team["org"],)
        )
        connection.execute(
            "UPDATE users SET display_name = 'Engagement lead', "
            "email = 'coverage.lead@example.com' WHERE id = %s",
            (team["owner_id"],),
        )
        connection.execute(
            "UPDATE users SET display_name = 'Engagement reviewer', "
            "email = 'coverage.reviewer@example.com' WHERE id = %s",
            (team["reviewer_id"],),
        )
        connection.execute(
            "INSERT INTO auth_sessions (user_id, token_hash, expires_at) "
            "VALUES (%s, %s, clock_timestamp() + interval '8 hours')",
            (team["owner_id"], token_hash(token)),
        )
        connection.commit()
    # The checks list shows only while a check fails: no recipient yet, as a new request
    # of a control without an owner email reads.
    for request in (phase, design):
        _unassigned(client, team, request)
    _overfull(seed, team, client, overfull)
    _replanned(seed, team, client, replanned)
    _rejected(seed, team, client, rejected)
    for name, request, ref in (
        ("pbc-sample-request", sample, str(plan.get("control_ref", ""))),
        ("pbc-phase-request", phase, phase_ref),
        ("pbc-design-request", design, design_ref),
        ("pbc-unphased-request", unphased, unphased_ref),
        ("pbc-overfull-request", overfull, overfull_ref),
        ("pbc-replanned-request", replanned, replanned_ref),
        ("pbc-rejected-request", rejected, rejected_ref),
    ):
        seed.add(
            name,
            seed.href(team, section="evidence", request=str(request)),
            request=str(request),
            control=ref,
            token=token,
        )
