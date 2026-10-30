"""The synthetic scenario date of a demo engagement (migration 0131).

A demo engagement is set in a fictional period. The audit's workflow compares a date
with "today" in three places: whether a remediation can have taken effect, whether a
retest may start, and how the schedule's milestones read. For a demo engagement those
read the engagement's scenario date; for every real engagement, and for everything else
(subscriptions, authentication, authorization, AI budgets), the clock is the only time.
"""

from datetime import UTC, date, datetime
from typing import Any
from uuid import UUID


def scenario_today(connection: Any, project_id: UUID | None) -> date:
    """Today, as the engagement's workflow should see it: the clock, or for a demo
    engagement with a scenario date, that date."""
    today = datetime.now(UTC).date()
    if project_id is None:
        return today
    row = connection.execute(
        """
        SELECT s.scenario_as_of
        FROM engagement_settings s JOIN projects p ON p.id = s.project_id
        WHERE s.project_id = %s AND p.demo
        """,
        (project_id,),
    ).fetchone()
    if row is None or not isinstance(row[0], date):
        return today
    return row[0]
