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
    connection: Any, project: UUID, phase: str, skip: set[UUID], ref: str | None = None
) -> tuple[UUID, str]:
    row = connection.execute(
        """
        SELECT r.id, c.control_ref FROM pbc_requests r
        JOIN engagement_controls c ON c.id = r.engagement_control_id
        WHERE r.project_id = %s AND r.status = 'DRAFT' AND r.testing_phase = %s
          AND r.id <> ALL(%s::uuid[]) AND (%s::text IS NULL OR c.control_ref = %s)
          AND EXISTS (
              SELECT 1 FROM evidence_requirements e
              WHERE e.pbc_request_id = r.id AND e.status = 'REQUESTED'
          )
        ORDER BY c.control_ref, r.created_at
        LIMIT 1
        """,
        (project, phase, list(skip), ref, ref),
    ).fetchone()
    assert row is not None, f"no {phase} draft request with planned evidence"
    return UUID(str(row[0])), str(row[1])


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
    for name, request, ref in (
        ("pbc-sample-request", sample, str(plan.get("control_ref", ""))),
        ("pbc-phase-request", phase, phase_ref),
        ("pbc-design-request", design, design_ref),
        ("pbc-unphased-request", unphased, unphased_ref),
    ):
        seed.add(
            name,
            seed.href(team, section="evidence", request=str(request)),
            request=str(request),
            control=ref,
            token=token,
        )
