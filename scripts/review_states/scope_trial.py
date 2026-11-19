"""Map controls on the free trial (scope-trial-limit, 19 November 2026).

A launched engagement over one system the rules reviewed, with two controls mapped, whose
firm is on the free trial (the deployment's trial limits: 5 controls per engagement): the
state the owner was in when Map controls refused a selection of 11 with a retry line.

The engagement is set up and launched through the API as the owner would; a firm on the
trial cannot name an independent reviewer (one member), so the firm is moved onto the
trial after the launch, as a recorded change (status_reason, updated_by), the way the
subscription tests change a firm's plan.
"""

from typing import Any
from uuid import UUID

from test_onboarding import _base, _choose_methodology, _new_engagement, _pbc

from ai_workforce_api.db import connect
from ai_workforce_api.settings import Settings
from ai_workforce_api.system_scoping import run_review


def build(seed: Any) -> None:
    team = _new_engagement(seed.database, "trial-scope")
    owner, base = team["owner"], _base(team["org"], team["project"])
    assert (
        owner.patch(
            f"{base}/scope",
            json={"scope": "ITGCs over Workday for FY2027", "period_end": "2027-12-31"},
        ).status_code
        == 200
    )
    added = owner.post(f"{base}/applications/known", json={"names": ["Workday"]})
    assert added.status_code == 200, added.text
    system = next(a for a in added.json()["applications"] if a["name"] == "Workday")
    for user_id, role in ((team["owner_id"], "LEAD"), (team["reviewer_id"], "REVIEWER")):
        joined = owner.post(f"{base}/team", json={"user_id": str(user_id), "engagement_role": role})
        assert joined.status_code == 200, joined.text
    assert owner.post(f"{base}/systems/{system['id']}/review").status_code == 200
    with connect(seed.database.url) as connection:
        assert run_review(connection, None, UUID(system["id"])) == "DONE"
    options = owner.get(f"{base}/scope/options", params={"system_id": system["id"]}).json()
    keys = [item["library_key"] for item in options["controls"]][:2]
    chosen = owner.post(
        f"{base}/scope/select", json={"system_id": system["id"], "library_keys": keys}
    )
    assert chosen.status_code == 200, chosen.text
    for domain, email in (
        ("ACCESS", "iam@client.example"),
        ("CHANGE", "release@client.example"),
        ("OPERATIONS", "ops@client.example"),
    ):
        owner.post(
            f"{base}/controls/owner",
            json={"domain": domain, "owner_name": f"{domain.title()} owner", "owner_email": email},
        )
    assert owner.patch(f"{base}/pbc", json=_pbc()).status_code == 200
    assert owner.post(f"{base}/templates/confirm").status_code == 200
    _choose_methodology(owner, base)
    plan = owner.post(f"{base}/plan").json()["plan"]
    launched = owner.post(
        f"{base}/plan/{plan['id']}/approve", json={"fingerprint": plan["fingerprint"]}
    )
    assert launched.status_code == 200, launched.text

    limits = Settings(database_url=seed.database.url)
    with connect(seed.database.url) as connection:
        connection.execute(
            """
            UPDATE organization_subscriptions
            SET status = 'TRIAL', plan_type = 'TRIAL',
                trial_started_at = coalesce(trial_started_at, clock_timestamp()),
                trial_expires_at = clock_timestamp() + make_interval(days => %s),
                limit_engagements = %s, limit_systems = %s, limit_controls = %s,
                limit_members = %s, limit_uploads = %s, limit_upload_bytes = %s,
                ai_budget_micros = %s, ai_run_limit = %s, ai_concurrent_runs = %s,
                ai_run_seconds = %s, status_reason = 'review state: on the trial',
                updated_by = %s, version = version + 1
            WHERE organization_id = %s
            """,
            (
                limits.trial_days, limits.trial_limit_engagements, limits.trial_limit_systems,
                limits.trial_limit_controls, limits.trial_limit_members,
                limits.trial_limit_uploads, limits.trial_limit_upload_bytes,
                limits.trial_ai_budget_micros, limits.trial_ai_run_limit,
                limits.trial_ai_concurrent_runs, limits.trial_ai_run_seconds,
                team["owner_id"], team["org"],
            ),
        )  # fmt: skip
        connection.execute(
            "UPDATE organizations SET name = 'Example Trial Firm' WHERE id = %s", (team["org"],)
        )
        connection.commit()
    seed.add(
        "scope-trial",
        seed.href(team, section="controls"),
        user_id=str(team["owner_id"]),
        system_id=system["id"],
        allowed=limits.trial_limit_controls,
        mapped=len(keys),
    )
