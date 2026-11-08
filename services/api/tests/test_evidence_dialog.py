"""The evidence dialog's API (product owner, 31 October 2026): a population read as a table
for its Data view, a sample size the person chooses, and the walkthrough instance an
auditor picks from a population uploaded on a design item."""

from uuid import UUID, uuid4

import psycopg
import pytest
from support import Database
from test_evidence_findings import _design_request
from test_evidence_intake import _client, _engagement
from test_evidence_plans import _control, _phase, _plan
from test_evidence_review import _sent_engagement_request
from test_execution import _add_project_member, _add_user
from test_outbound import migrated
from test_sampling import _no_engines, _store, _tests
from test_testing_engine import _add, _base

from ai_workforce_api.db import connect
from ai_workforce_api.evidence_analysis import run_analysis
from ai_workforce_api.settings import Settings

_ = migrated


def _population(rows: int = 40, year: int = 2026) -> str:
    lines = ["User ID,Name,Role granted,Date granted,Ticket"]
    for n in range(1, rows + 1):
        lines.append(f"u{n:04d},Demo User {n},Clerk,{year}-{(n % 12) + 1:02d}-10,REQ-{n}")
    return "\n".join(lines) + "\n"


def _uuid(value: object) -> UUID:
    return value if isinstance(value, UUID) else UUID(str(value))


def test_a_population_reads_as_a_table_and_the_person_chooses_the_sample_size(
    migrated: Database,
) -> None:
    team, client, request = _sent_engagement_request(migrated, "dialog-size", "ITGC-AC-01")
    with connect(migrated.url) as connection:
        found = connection.execute(
            "SELECT period_end FROM engagement_settings WHERE project_id = %s", (team["project"],)
        ).fetchone()
    assert found is not None
    year = int(found[0].year)
    analysis_id = _store(client, team, request, _population(40, year).encode(), "grants.csv")
    with connect(migrated.url) as connection:
        run_analysis(
            connection, Settings(database_url=migrated.url), None, analysis_id, _no_engines
        )
    [proposed] = _tests(client, team)
    file_id = proposed["population_file_id"]
    base = f"/organizations/{team['org']}/projects/{team['project']}"

    # The Data view: a page of rows, numbered as sampling numbers them, and a search.
    page = client.get(f"{base}/evidence-files/{file_id}/table", params={"limit": 5})
    assert page.status_code == 200, page.text
    body = page.json()
    assert body["columns"][:2] == ["User ID", "Name"]
    assert (body["total"], body["matched"], body["key_column"]) == (40, 40, "User ID")
    assert body["date_column"] == "Date granted"
    assert [row["row_number"] for row in body["rows"]] == [1, 2, 3, 4, 5]
    found = client.get(f"{base}/evidence-files/{file_id}/table", params={"search": "u0037"})
    assert [row["row_number"] for row in found.json()["rows"]] == [37]
    too_many = client.get(f"{base}/evidence-files/{file_id}/table", params={"limit": 500})
    assert too_many.status_code == 422

    # Another firm reads nothing of it.
    other, other_client, _request = _sent_engagement_request(migrated, "dialog-other", "ITGC-AC-01")
    assert other_client.get(f"{base}/evidence-files/{file_id}/table").status_code in (403, 404)
    elsewhere = f"/organizations/{other['org']}/projects/{other['project']}"
    assert other_client.get(f"{elsewhere}/evidence-files/{file_id}/table").status_code == 404

    # The person's size, kept beside the plan's; the plan's size when none is given.
    plan_size = proposed["sample_size"]
    chosen = client.post(
        f"{base}/control-tests/propose", json={"evidence_file_id": file_id, "sample_size": 3}
    )
    assert chosen.status_code == 200, chosen.text
    assert (chosen.json()["sample_size"], len(chosen.json()["samples"])) == (3, 3)
    with connect(migrated.url) as connection:
        audited = connection.execute(
            "SELECT payload FROM audit_events WHERE project_id = %s "
            "AND action = 'control_test.sample_size_chosen'",
            (team["project"],),
        ).fetchall()
    assert [row[0] for row in audited] == [{"plan_size": plan_size, "chosen_size": 3}]
    for size in (0, 201):
        refused = client.post(
            f"{base}/control-tests/propose", json={"evidence_file_id": file_id, "sample_size": size}
        )
        assert refused.status_code == 422
    planned = client.post(f"{base}/control-tests/propose", json={"evidence_file_id": file_id})
    assert planned.json()["sample_size"] == plan_size

    # A chosen size does not let samples past the population's acceptance: a person still
    # accepts the population, then approves the samples.
    early = client.post(
        f"{base}/control-tests/{planned.json()['id']}/approve",
        json={"version": planned.json()["version"]},
    )
    assert early.status_code == 409


def test_an_auditor_picks_a_walkthrough_instance_from_a_design_population(
    migrated: Database,
) -> None:
    team, client, _scheduler = _engagement(migrated, "dialog-pick")
    control = _control(migrated, team, "ITGC-AC-01")
    request_id, _item = _design_request(client, team, control)
    _add(client, team, "grants.csv", _population(12), request_id)
    files = client.get(f"{_base(team)}/evidence-register").json()["files"]
    file_id = next(f["id"] for f in files if f["file_name"] == "grants.csv")
    design = _phase(_plan(client, team, control), "DESIGN")
    item = next(r for r in design["requirements"] if r["request_id"] == request_id)
    interim = _phase(_plan(client, team, control), "INTERIM")["requirements"][0]
    base = f"{_base(team)}/controls/{control}"

    first = client.post(
        f"{base}/evidence-requirements/{item['id']}/walkthrough-instance",
        json={"file_id": file_id, "row_number": 2, "note": "A manager-approved grant."},
    )
    assert first.status_code == 200, first.text
    [current] = first.json()["instances"]
    assert (current["row_number"], current["key_column"], current["key_value"]) == (
        2, "User ID", "u0002",
    )  # fmt: skip
    assert current["values"][0] == "u0002" and current["superseded_at"] is None

    # A later pick supersedes the earlier one, which stays on record.
    again = client.post(
        f"{base}/evidence-requirements/{item['id']}/walkthrough-instance",
        json={"file_id": file_id, "row_number": 5},
    )
    assert again.status_code == 200, again.text
    picks = again.json()["instances"]
    assert [(p["row_number"], p["superseded_at"] is None) for p in picks] == [
        (5, True), (2, False),
    ]  # fmt: skip

    # Only a design item, only a row the population has.
    wrong_phase = client.post(
        f"{base}/evidence-requirements/{interim['id']}/walkthrough-instance",
        json={"file_id": file_id, "row_number": 1},
    )
    assert wrong_phase.status_code == 409
    assert "design item" in wrong_phase.json()["detail"]
    beyond = client.post(
        f"{base}/evidence-requirements/{item['id']}/walkthrough-instance",
        json={"file_id": file_id, "row_number": 99},
    )
    assert beyond.status_code == 409

    # An independent reviewer reads the picks but makes none; another firm sees nothing.
    with connect(migrated.url) as connection:
        reviewer = _add_user(
            connection, _uuid(team["org"]), f"rev-{uuid4().hex[:6]}@example.com", "REVIEWER"
        )
        _add_project_member(connection, _uuid(team["org"]), _uuid(team["project"]), reviewer)
    independent = _client(migrated, reviewer, None)
    assert independent.get(f"{base}/walkthrough-instances").status_code == 200
    assert (
        independent.post(
            f"{base}/evidence-requirements/{item['id']}/walkthrough-instance",
            json={"file_id": file_id, "row_number": 1},
        ).status_code
        == 403
    )
    _other, other_client, _s = _engagement(migrated, "dialog-pick-other")
    assert other_client.get(f"{base}/walkthrough-instances").status_code in (403, 404)

    # A pick is never edited or deleted; each is audited.
    with connect(migrated.url) as connection:
        picked_id = picks[0]["id"]
        with pytest.raises(psycopg.Error):
            connection.execute(
                "UPDATE walkthrough_instances SET key_value = 'x' WHERE id = %s", (picked_id,)
            )
        connection.rollback()
        with pytest.raises(psycopg.Error):
            connection.execute("DELETE FROM walkthrough_instances WHERE id = %s", (picked_id,))
        connection.rollback()
        audited = connection.execute(
            "SELECT count(*) FROM audit_events WHERE project_id = %s "
            "AND action = 'evidence.walkthrough_instance_selected'",
            (team["project"],),
        ).fetchone()
    assert audited is not None and int(audited[0]) == 2


def test_the_readers_reason_is_cut_at_a_sentence_never_mid_word() -> None:
    from ai_workforce_api.evidence_classify import sentence_cut

    reason = (
        "The file lists grants across many users. It is not a walkthrough. The rows run "
        "only to late September 2027. The file does not say how it was generated."
    )
    assert sentence_cut(reason, 500) == reason
    assert sentence_cut(reason, 90) == (
        "The file lists grants across many users. It is not a walkthrough."
    )
    words = sentence_cut("grant " * 30, 40)
    assert words.endswith("…") and len(words) <= 40 and not words[:-1].endswith(" ")
