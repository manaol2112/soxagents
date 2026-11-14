"""Demo datasets: what a firm's synthetic demo engagement is built from (Trial Management
and Synthetic Demo Experience, Step 3).

Demo initialization (demo.py) asks the configured dataset to build one engagement for
the firm, inside its own transaction, with the demo marker the database lets only that
transaction set. A dataset is versioned by its key (`name/version`) so the record says
which one a firm's demo came from, and a later version never changes an existing demo.

Step 4 adds the Northstar Technologies dataset (three systems, fourteen controls, the
synthetic personnel, planning, evidence requests, evidence files, testing, exceptions,
remediation and reports). Until then the only dataset is a placeholder for integration
testing, marked incomplete: it is enabled by DEMO_DATASET=placeholder/0 in a development
deployment and never presented as the demo.
"""

from dataclasses import dataclass
from datetime import date
from typing import Any, Protocol
from uuid import UUID

import psycopg

from ai_workforce_api.clients import assign_client
from ai_workforce_api.settings import Settings

CLIENT_NAME = "Northstar Technologies"


@dataclass(frozen=True)
class DemoContext:
    """What a build knows: the firm, who asked, which demo of theirs this is (1 for the
    first; a reset makes the next), and the day."""

    organization_id: UUID
    requested_by: UUID
    sequence: int
    today: date
    # The deployment's settings, for the object store the evidence files go to.
    settings: Settings | None = None

    @property
    def slug(self) -> str:
        return "northstar-demo" if self.sequence == 1 else f"northstar-demo-{self.sequence}"


def free_slug(cursor: psycopg.Cursor[Any], organization_id: UUID, base: str) -> str:
    """The base slug, or the first numbered one the firm does not already use: a firm
    may have named an engagement of its own that way."""
    slug = base
    for n in range(2, 100):
        cursor.execute(
            "SELECT 1 FROM projects WHERE organization_id = %s AND slug = %s",
            (organization_id, slug),
        )
        if cursor.fetchone() is None:
            return slug
        slug = f"{base}-{n}"
    raise ValueError("no free slug for the demo engagement")


class DemoDataset(Protocol):
    """One version of a demo dataset. `build` makes the firm's engagement and everything
    on it, in the caller's transaction, and returns the engagement's id."""

    @property
    def key(self) -> str: ...

    @property
    def title(self) -> str: ...

    @property
    def complete(self) -> bool:
        """Whether a person may be shown this demo as ready: the whole audit lifecycle is
        on it. An incomplete dataset is for integration testing only."""
        ...

    def build(self, cursor: psycopg.Cursor[Any], context: DemoContext) -> UUID: ...


class PlaceholderDataset:
    """A draft engagement for the synthetic client and nothing else: enough to exercise
    initialization, the marker, the allowances and the navigation end to end."""

    key = "placeholder/0"
    title = f"{CLIENT_NAME} (demo preparation)"
    complete = False

    def build(self, cursor: psycopg.Cursor[Any], context: DemoContext) -> UUID:
        cursor.execute(
            """
            INSERT INTO projects (organization_id, name, slug, scope, owner_user_id, status, demo)
            VALUES (%s, %s, %s, %s, %s, 'DRAFT', true)
            RETURNING id
            """,
            (
                context.organization_id,
                f"SOX ITGC demo FY{context.today.year}",
                free_slug(cursor, context.organization_id, context.slug),
                "Synthetic demo engagement. Nothing here is real organization data.",
                context.requested_by,
            ),
        )
        row = cursor.fetchone()
        assert row is not None
        project_id = UUID(str(row[0]))
        cursor.execute(
            """
            INSERT INTO project_memberships (organization_id, project_id, user_id)
            VALUES (%s, %s, %s)
            """,
            (context.organization_id, project_id, context.requested_by),
        )
        # The settings row comes from the projects trigger; the profile goes on it.
        cursor.execute(
            """
            UPDATE engagement_settings
            SET engagement_type = 'SOX_ITGC', period_end = %s,
                version = version + 1, updated_at = clock_timestamp()
            WHERE project_id = %s
            """,
            (date(context.today.year, 12, 31), project_id),
        )
        assign_client(
            cursor, context.organization_id, project_id, context.requested_by, name=CLIENT_NAME
        )
        return project_id


DATASETS: dict[str, DemoDataset] = {PlaceholderDataset.key: PlaceholderDataset()}


def _register_northstar() -> None:
    # Imported here: the dataset package reads this module's context types.
    from ai_workforce_api.demo_northstar.dataset import NorthstarDataset

    DATASETS[NorthstarDataset.key] = NorthstarDataset()


_register_northstar()


def configured(settings: Settings) -> DemoDataset | None:
    """The dataset this deployment builds demos from; None when no demo is available yet
    (the default: the invitation then leads to the preparation notice, never to an empty
    engagement)."""
    key = settings.demo_dataset.strip()
    return DATASETS.get(key) if key != "" else None
