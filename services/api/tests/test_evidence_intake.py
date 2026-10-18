"""Evidence the team uploads: matched to controls by the agent, filed, and received."""

from typing import Any
from uuid import UUID, uuid4

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from support import Database, approve_evidence_plans
from test_evidence_analysis import _classification, _no_ocr, _Provider
from test_onboarding import _base as _setup_base
from test_onboarding import _complete_setup, _new_engagement
from test_outbound import migrated

from ai_workforce_api.auth import token_hash
from ai_workforce_api.db import connect
from ai_workforce_api.evidence_analysis import run_analysis
from ai_workforce_api.evidence_intake import clean_folder, clean_name, clean_type
from ai_workforce_api.evidence_matching import (
    Candidate,
    FileFacts,
    check_match,
    keyword_suggestions,
    named_controls,
    rules_match,
)
from ai_workforce_api.main import create_app
from ai_workforce_api.settings import Settings

_ = migrated

POPULATION = b"user_id,name,created,approved_by\nu1,Ann,2027-02-01,Lee\nu2,Bo,2027-03-04,Lee\n"


def _candidate(ref: str, title: str, requested: tuple[str, ...] = ()) -> Candidate:
    return Candidate(
        control_id=uuid4(),
        control_ref=ref,
        title=title,
        activity="",
        area="Access",
        systems=("SAP ERP",),
        requested=requested,
    )


POOL = [
    _candidate("ITGC-AC-01", "New user access is approved", ("Listing of new users",)),
    _candidate("ITGC-AC-10", "Firewall rules are reviewed"),
    _candidate("ITGC-CM-01", "Production changes are approved", ("Change ticket listing",)),
]


def _facts(name: str, folder: str = "", text: str = "") -> FileFacts:
    return FileFacts(file_name=name, folder_path=folder, file_kind="table", text=text, columns=())


def test_a_control_id_in_the_folder_or_name_is_a_confident_match() -> None:
    by_folder = rules_match(_facts("users.xlsx", "Acme PBC/ITGC AC 1/Q4"), POOL)
    assert by_folder is not None and by_folder.control is not None
    assert by_folder.control.control_ref == "ITGC-AC-01"
    assert by_folder.reason == "The folder names ITGC-AC-01."
    by_short = rules_match(_facts("AC-10 rules export.csv"), POOL)
    assert by_short is not None and by_short.control is not None
    assert by_short.control.control_ref == "ITGC-AC-10"
    assert by_short.reason == "The file name names ITGC-AC-10."
    # AC-1 is not AC-10, and two named controls are not a confident match.
    assert [c.control_ref for c in named_controls("itgc_ac_10.xlsx", POOL)] == ["ITGC-AC-10"]
    assert rules_match(_facts("ITGC-AC-01 and ITGC-CM-01.xlsx"), POOL) is None
    assert rules_match(_facts("listing.xlsx", "evidence"), POOL) is None


def test_the_model_can_only_file_a_listed_control_with_confidence() -> None:
    sure = check_match(
        {"control_ref": "itgc-cm-01", "confidence": 0.92, "reason": "Change tickets."}, POOL
    )
    assert sure.control is not None and sure.control.control_ref == "ITGC-CM-01"
    unsure = check_match(
        {
            "control_ref": "ITGC-CM-01",
            "confidence": 0.55,
            "reason": "Could be change tickets.",
            "alternatives": [
                {"control_ref": "ITGC-AC-01", "reason": "Has user names."},
                {"control_ref": "ITGC-ZZ-99", "reason": "Not real."},
            ],
        },
        POOL,
    )
    assert unsure.control is None
    assert [s.control_ref for s in unsure.suggestions] == ["ITGC-CM-01", "ITGC-AC-01"]
    with pytest.raises(ValueError, match="not in scope"):
        check_match({"control_ref": "ITGC-ZZ-99", "confidence": 0.99, "reason": "x"}, POOL)
    none = check_match({"control_ref": "", "confidence": 0.1, "reason": ""}, POOL)
    assert none.control is None and none.reason == "No in-scope control fits."
    words = keyword_suggestions(_facts("new users listing.xlsx", "access"), POOL)
    assert [s.control_ref for s in words] == ["ITGC-AC-01"]


def test_names_and_folders_from_the_computer_are_checked() -> None:
    assert clean_folder("\\Acme\\AC-01\\") == "Acme/AC-01"
    assert clean_folder("./a//b/") == "a/b"
    for bad in ("../secrets", "a/../../b", "C:/Windows", "a\x00b", "x" * 501):
        with pytest.raises(HTTPException):
            clean_folder(bad)
    assert clean_name(" users.xlsx ") == "users.xlsx"
    for bad in ("", "a/b.txt", "..", ".DS_Store", "Thumbs.db", "~$draft.docx", "._x.png"):
        with pytest.raises(HTTPException):
            clean_name(bad)
    assert clean_type("text/csv; charset=utf-8") == "text/csv"
    assert clean_type("<script>") == "application/octet-stream"


def test_an_upload_is_filed_by_the_agent_and_its_draft_request_is_received(
    migrated: Database,
) -> None:
    team, client, scheduler = _engagement(migrated, "intake")
    base = _base(team)
    request = _request(migrated, team, "ITGC-AC-01")
    submitted = client.post(
        f"{base}/pbc-requests/{request['id']}/submit", json={"version": request["version"]}
    )
    assert submitted.status_code == 200, submitted.text
    batch = str(uuid4())
    uploaded = _upload(client, team, batch, "new users.csv", "Acme PBC/ITGC-AC-01")
    assert uploaded["duplicate"] is False
    # Uploading the same folder again stores nothing new.
    again = _upload(client, team, batch, "new users.csv", "Acme PBC/ITGC-AC-01")
    assert again == {**uploaded, "duplicate": True}
    assert len(scheduler.analyses) == 1
    row = _row(client, team, uploaded["file_id"])
    assert row["state"] == "READING"
    with connect(migrated.url) as connection:
        assert (
            run_analysis(connection, _settings(migrated), None, scheduler.analyses[0], _no_ocr)
            == "READY"
        )
        moved = connection.execute(
            "SELECT status, provided_directly FROM pbc_requests WHERE id = %s", (request["id"],)
        ).fetchone()
        approval = connection.execute(
            "SELECT decision FROM approvals WHERE parameters ->> 'request_ref' LIKE %s",
            (f"pbc/{request['id']}/%",),
        ).fetchone()
        audit = str(
            connection.execute(
                "SELECT array_agg(action) FROM audit_events WHERE project_id = %s",
                (team["project"],),
            ).fetchone()
        )
    assert moved == ("RECEIVED", True)
    # The pending send approval is withdrawn, so the request never goes out.
    assert approval == ("EXPIRED",)
    for action in ("evidence.uploaded", "pbc.received_from_evidence", "approval.withdrawn"):
        assert action in audit
    row = _row(client, team, uploaded["file_id"])
    assert row["state"] == "FILED"
    assert row["filed_by"] == "AGENT"
    assert row["folder_path"] == "Acme PBC/ITGC-AC-01"
    assert row["control"]["control_ref"] == "ITGC-AC-01"
    assert row["request"] == {"id": request["id"], "status": "RECEIVED", "provided_directly": True}
    # The reason names the instance: the control and its application (Milestone 8.5).
    assert row["match_reason"] == "The folder names ITGC-AC-01 · SAP ERP."
    # The request register shows it as provided directly.
    listed = client.get(f"{base}/pbc-requests").json()
    assert next(r for r in listed if r["id"] == request["id"])["provided_directly"] is True


def test_an_unclear_file_waits_for_a_person_who_files_and_moves_it(migrated: Database) -> None:
    team, client, scheduler = _engagement(migrated, "unclear")
    base = _base(team)
    first = _request(migrated, team, "ITGC-CM-01")
    second = _request(migrated, team, "ITGC-CM-02")
    uploaded = _upload(client, team, str(uuid4()), "export.csv", "misc")
    unsure = {
        "control_ref": "ITGC-CM-01",
        "confidence": 0.5,
        "reason": "It could be a change listing.",
        "alternatives": [{"control_ref": "ITGC-CM-02", "reason": "Or emergency changes."}],
    }
    provider = _Provider([unsure, _classification("population")])
    with connect(migrated.url) as connection:
        run_analysis(connection, _settings(migrated), provider, scheduler.analyses[0], _no_ocr)
    # The match prompt lists the in-scope controls; the file's words are marked as data.
    assert "ITGC-CM-01" in provider.requests[0].prompt
    assert "<evidence_excerpt>" in provider.requests[0].prompt
    row = _row(client, team, uploaded["file_id"])
    assert row["state"] == "NEEDS_MATCH"
    assert row["control"] is None
    assert [s["control_ref"] for s in row["suggestions"]] == [
        "ITGC-CM-01 · SAP ERP",
        "ITGC-CM-02 · SAP ERP",
    ]
    assert row["confidence"] == 0.5
    assert _status(migrated, first["id"]) == "DRAFT"
    control_id = row["suggestions"][0]["control_id"]
    filing = f"{base}/evidence-files/{uploaded['file_id']}/filing"
    stale = client.post(
        filing, json={"version": row["filing_version"] + 5, "control_id": control_id}
    )
    assert stale.status_code == 409
    filed = client.post(filing, json={"version": row["filing_version"], "control_id": control_id})
    assert filed.status_code == 200, filed.text
    row = filed.json()["files"][0]
    assert (row["state"], row["filed_by"], row["read_status"]) == ("FILED", "PERSON", "PENDING")
    # While it is read again against its control, it cannot be moved.
    busy = client.post(filing, json={"version": row["filing_version"], "control_id": None})
    assert busy.status_code == 409
    with connect(migrated.url) as connection:
        run_analysis(
            connection,
            _settings(migrated),
            _Provider([_classification("population")]),
            scheduler.analyses[-1],
            _no_ocr,
        )
    assert _status(migrated, first["id"]) == "RECEIVED"
    # Moving it to another control puts the first request back to draft.
    row = _row(client, team, uploaded["file_id"])
    other = row["suggestions"][1]["control_id"]
    moved = client.post(filing, json={"version": row["filing_version"], "control_id": other})
    assert moved.status_code == 200, moved.text
    assert _status(migrated, first["id"]) == "DRAFT"
    with connect(migrated.url) as connection:
        run_analysis(
            connection,
            _settings(migrated),
            _Provider([_classification("population")]),
            scheduler.analyses[-1],
            _no_ocr,
        )
        direct = connection.execute(
            "SELECT provided_directly FROM pbc_requests WHERE id = %s", (first["id"],)
        ).fetchone()
    assert direct == (False,)
    assert _status(migrated, second["id"]) == "RECEIVED"
    row = _row(client, team, uploaded["file_id"])
    assert row["control"]["control_ref"] == "ITGC-CM-02"
    # Taking it off its control returns it to the files that need a match.
    unfiled = client.post(filing, json={"version": row["filing_version"], "control_id": None})
    assert unfiled.status_code == 200
    assert unfiled.json()["files"][0]["state"] == "NEEDS_MATCH"
    assert _status(migrated, second["id"]) == "DRAFT"


def test_a_model_answer_naming_an_unknown_control_is_not_filed(migrated: Database) -> None:
    team, client, scheduler = _engagement(migrated, "unknown")
    uploaded = _upload(client, team, str(uuid4()), "evidence.csv")
    made_up = {"control_ref": "ITGC-ZZ-99", "confidence": 0.99, "reason": "Trust me."}
    with connect(migrated.url) as connection:
        run_analysis(
            connection,
            _settings(migrated),
            _Provider([made_up, _classification("other")]),
            scheduler.analyses[0],
            _no_ocr,
        )
    row = _row(client, team, uploaded["file_id"])
    assert row["state"] == "NEEDS_MATCH"
    assert "not in scope" in row["match_reason"]


def test_a_file_added_on_a_request_is_filed_to_it_without_matching(
    migrated: Database,
) -> None:
    team, client, scheduler = _engagement(migrated, "onrequest")
    base = _base(team)
    request = _request(migrated, team, "ITGC-OP-01")
    # The name points elsewhere, but the person chose the request, so it is not matched.
    added = client.post(
        f"{base}/evidence-uploads",
        params={
            "batch_id": str(uuid4()),
            "name": "ITGC-CM-01 export.csv",
            "request_id": request["id"],
        },
        content=POPULATION,
        headers={"content-type": "text/csv"},
    )
    assert added.status_code == 200, added.text
    row = _row(client, team, added.json()["file_id"])
    assert (row["state"], row["filed_by"]) == ("FILED", "PERSON")
    assert row["control"]["control_ref"] == "ITGC-OP-01"
    assert row["match_reason"] == "Added on its evidence request."
    provider = _Provider([_classification("population")])
    with connect(migrated.url) as connection:
        run_analysis(connection, _settings(migrated), provider, scheduler.analyses[0], _no_ocr)
    # Only the classification ran: no matching call.
    assert len(provider.requests) == 1
    assert "Classify this evidence file" in provider.requests[0].prompt
    assert _status(migrated, request["id"]) == "RECEIVED"
    # A closed request takes no more evidence; another engagement's request is not found.
    with connect(migrated.url) as connection:
        connection.execute(
            "UPDATE pbc_requests SET status = 'CLOSED' WHERE id = %s", (request["id"],)
        )
    closed = client.post(
        f"{base}/evidence-uploads",
        params={"batch_id": str(uuid4()), "name": "more.csv", "request_id": request["id"]},
        content=b"a,b\n1,2\n",
    )
    assert closed.status_code == 409
    elsewhere = client.post(
        f"{base}/evidence-uploads",
        params={"batch_id": str(uuid4()), "name": "more.csv", "request_id": str(uuid4())},
        content=b"a,b\n1,2\n",
    )
    assert elsewhere.status_code == 404
    assert len(scheduler.analyses) == 1


def test_an_archived_engagement_takes_no_new_evidence(migrated: Database) -> None:
    team, client, scheduler = _engagement(migrated, "archived")
    filed = _upload(client, team, str(uuid4()), "users.csv", "ITGC-AC-01")
    with connect(migrated.url) as connection:
        run_analysis(connection, _settings(migrated), None, scheduler.analyses[0], _no_ocr)
        connection.execute(
            "UPDATE projects SET status = 'ARCHIVED' WHERE id = %s", (team["project"],)
        )
    params = {"batch_id": str(uuid4()), "name": "late.csv"}
    late = client.post(f"{_base(team)}/evidence-uploads", params=params, content=POPULATION)
    assert late.status_code == 409
    assert "not active" in late.json()["detail"]
    row = _row(client, team, filed["file_id"])
    moved = client.post(
        f"{_base(team)}/evidence-files/{filed['file_id']}/filing",
        json={"version": row["filing_version"], "control_id": None},
    )
    assert moved.status_code == 409
    # What was filed stays readable.
    assert row["state"] == "FILED"
    assert len(scheduler.analyses) == 1


def test_bad_uploads_are_refused(migrated: Database) -> None:
    team, client, scheduler = _engagement(migrated, "refused")
    base = _base(team)
    params = {"batch_id": str(uuid4()), "name": "a.csv", "path": "../up"}
    assert client.post(f"{base}/evidence-uploads", params=params, content=b"x").status_code == 422
    params = {"batch_id": str(uuid4()), "name": ".DS_Store"}
    assert client.post(f"{base}/evidence-uploads", params=params, content=b"x").status_code == 422
    params = {"batch_id": str(uuid4()), "name": "empty.csv"}
    assert client.post(f"{base}/evidence-uploads", params=params, content=b"").status_code == 422
    assert scheduler.analyses == []
    anonymous = TestClient(create_app(Settings(database_url=migrated.url)))
    params = {"batch_id": str(uuid4()), "name": "a.csv"}
    assert (
        anonymous.post(f"{base}/evidence-uploads", params=params, content=b"x").status_code == 401
    )


# Helpers


class _Scheduler:
    def __init__(self) -> None:
        self.analyses: list[UUID] = []
        self.reviews: list[UUID] = []

    def schedule_drafts(self, draft_ids: list[UUID]) -> None:
        del draft_ids

    def schedule_evidence_analyses(self, analysis_ids: list[UUID]) -> None:
        self.analyses.extend(analysis_ids)

    def schedule_reviews(self, review_ids: list[UUID]) -> None:
        self.reviews.extend(review_ids)


def _engagement(
    database: Database, slug: str, settle: bool = True
) -> tuple[dict[str, Any], TestClient, _Scheduler]:
    """A launched engagement whose evidence plans a person approved. With settle, the
    proposed attributes are decided too, so operating evidence is requested; without, the
    library's proposals stay for the test to decide."""
    team = _new_engagement(database, slug)
    scheduler = _Scheduler()
    client = _client(database, team["owner_id"], scheduler)
    _complete_setup(client, team)
    setup = _setup_base(team["org"], team["project"])
    plan = client.post(f"{setup}/plan").json()["plan"]
    started = client.post(
        f"{setup}/plan/{plan['id']}/approve", json={"fingerprint": plan["fingerprint"]}
    )
    assert started.status_code == 200, started.text
    # Nothing is requested before a person approves each control's evidence plan.
    approve_evidence_plans(database, team["project"], settle)
    return team, client, scheduler


def _client(database: Database, user_id: UUID, scheduler: _Scheduler) -> TestClient:
    settings = Settings(database_url=database.url, session_cookie_secure=False)
    token = uuid4().hex
    with connect(database.url) as connection:
        connection.execute(
            "INSERT INTO auth_sessions (user_id, token_hash, expires_at) "
            "VALUES (%s, %s, clock_timestamp() + interval '1 hour')",
            (user_id, token_hash(token)),
        )
    return TestClient(
        create_app(settings, draft_scheduler=scheduler), cookies={"aw_session": token}
    )


def _settings(database: Database) -> Settings:
    return Settings(database_url=database.url)


def _base(team: dict[str, Any]) -> str:
    return f"/organizations/{team['org']}/projects/{team['project']}"


def _upload(
    client: TestClient, team: dict[str, Any], batch: str, name: str, path: str = ""
) -> dict[str, Any]:
    response = client.post(
        f"{_base(team)}/evidence-uploads",
        params={"batch_id": batch, "name": name, "path": path},
        content=POPULATION,
        headers={"content-type": "text/csv"},
    )
    assert response.status_code == 200, response.text
    body: dict[str, Any] = response.json()
    return body


def _row(client: TestClient, team: dict[str, Any], file_id: str) -> dict[str, Any]:
    register = client.get(f"{_base(team)}/evidence-register")
    assert register.status_code == 200, register.text
    body = register.json()
    assert body["controls"], "the register lists the controls to file to"
    found: dict[str, Any] = next(item for item in body["files"] if item["id"] == file_id)
    return found


def _request(
    database: Database, team: dict[str, Any], control_ref: str, phase: str = "INTERIM"
) -> dict[str, Any]:
    """The control's kickoff request for one phase: the interim request asks for the
    population (or configuration), the design request for design evidence."""
    with connect(database.url) as connection:
        row = connection.execute(
            """
            SELECT r.id, r.version FROM pbc_requests r
            JOIN engagement_controls c ON c.id = r.engagement_control_id
            WHERE r.project_id = %s AND c.control_ref = %s AND r.testing_phase = %s
            ORDER BY r.created_at LIMIT 1
            """,
            (team["project"], control_ref, phase),
        ).fetchone()
    assert row is not None
    return {"id": str(row[0]), "version": int(row[1])}


def _accept_population(
    client: TestClient, team: dict[str, Any], control_id: str, phase: str = "INTERIM"
) -> None:
    """A person accepts the received population, and its completeness support, as
    sufficient on the control's evidence plan: samples are approved only after that."""
    found = client.get(f"{_base(team)}/controls/{control_id}/evidence-plan")
    assert found.status_code == 200, found.text
    for item in next(p for p in found.json()["phases"] if p["phase"] == phase)["requirements"]:
        gating = "POPULATION" in item["categories"] or (
            "REPORT_RELIABILITY" in item["categories"] and item["necessity"] == "REQUIRED"
        )
        arrived = item["state"] in ("RECEIVED", "PARTIALLY_RECEIVED")
        if item["depends_on"] is None and gating and arrived:
            accepted = client.post(
                f"{_base(team)}/controls/{control_id}/evidence-requirements/{item['id']}/sufficiency",
                json={"sufficiency": "ACCEPTED", "version": item["version"]},
            )
            assert accepted.status_code == 200, accepted.text


def _status(database: Database, request_id: str) -> str:
    with connect(database.url) as connection:
        row = connection.execute(
            "SELECT status FROM pbc_requests WHERE id = %s", (request_id,)
        ).fetchone()
    assert row is not None
    return str(row[0])


def test_a_file_is_filed_to_the_instance_of_the_application_it_shows() -> None:
    """Milestone 8.5: one control ID, one instance per application."""
    from ai_workforce_api.evidence_matching import instance_for

    ad, oracle = uuid4(), uuid4()
    family = [
        Candidate(
            control_id=uuid4(),
            control_ref="ITGC-AC-05",
            title="Password settings",
            activity="",
            area="Access",
            systems=(name,),
            requested=(),
            application_id=app_id,
            application=name,
        )
        for app_id, name in ((ad, "Active Directory"), (oracle, "Oracle Database"))
    ]
    pool = [*POOL, *family]
    assert family[1].label == "ITGC-AC-05 · Oracle Database"
    # The file name names the control and the application: that instance.
    named = rules_match(_facts("ITGC-AC-05 Oracle DB profiles.csv"), pool)
    assert named is not None and named.control is family[1]
    assert named.reason == "The file name names ITGC-AC-05; the file shows Oracle Database."
    # A policy for every application is filed to the first instance and shared.
    policy = FileFacts(
        file_name="ITGC-AC-05 standard.pdf",
        folder_path="",
        file_kind="policy",
        text="Applies to Active Directory and Oracle Database.",
        columns=(),
    )
    assert instance_for(family, policy) is family[0]
    # The control alone does not say which instance: a person chooses.
    assert rules_match(_facts("ITGC-AC-05 export.csv"), pool) is None
    # The model must name the instance; the bare ID is accepted only for one instance.
    with pytest.raises(ValueError, match="not in scope"):
        check_match({"control_ref": "ITGC-AC-05", "confidence": 0.9, "reason": "x"}, pool)
    sure = check_match(
        {"control_ref": "itgc-ac-05 · oracle database", "confidence": 0.9, "reason": "Oracle."},
        pool,
    )
    assert sure.control is family[1]
    assert check_match(
        {"control_ref": "ITGC-AC-01", "confidence": 0.9, "reason": "x"}, pool
    ).control
