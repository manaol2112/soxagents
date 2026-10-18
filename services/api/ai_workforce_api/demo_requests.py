"""Demo requests from the public landing page.

The only public write in the API. It stores a name, a work email, a firm, and a short
message (`demo_requests`, migration 0043) for a person to follow up. Nothing is sent.
A request that looks like it carries a secret is refused, and one source cannot leave
more than a few in an hour.
"""

import logging
import re
from typing import Any
from uuid import UUID

import psycopg
from fastapi import FastAPI, HTTPException, Request
from pydantic import BaseModel, Field

from ai_workforce_api.actions import contains_secret
from ai_workforce_api.db import connect, transaction
from ai_workforce_api.inbound import clean_line, clean_text
from ai_workforce_api.settings import Settings

logger = logging.getLogger(__name__)

PUBLIC_PATH = "/public/demo-requests"
HOURLY_LIMIT = 5
_EMAIL = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


class DemoRequestBody(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    email: str = Field(min_length=3, max_length=200)
    firm: str = Field(default="", max_length=200)
    message: str = Field(default="", max_length=2000)
    # Bots fill every field; people never see this one.
    website: str = Field(default="", max_length=200)


class DemoRequestReceipt(BaseModel):
    id: UUID
    received: bool = True


def register_demo_requests(app: FastAPI, settings: Settings) -> None:
    @app.post(PUBLIC_PATH, status_code=201)
    def leave_request(body: DemoRequestBody, request: Request) -> DemoRequestReceipt:
        if settings.database_url == "":
            raise HTTPException(status_code=503, detail="demo requests unavailable")
        source = request.client.host if request.client is not None else ""
        agent = request.headers.get("user-agent", "")
        try:
            with connect(settings.database_url) as connection:
                return save_request(connection, body, source, agent)
        except ValueError as error:
            raise HTTPException(status_code=422, detail=str(error)) from None
        except TooMany:
            raise HTTPException(
                status_code=429, detail="too many requests from here; try again later"
            ) from None
        except psycopg.Error:
            logger.warning("demo request could not be saved")
            raise HTTPException(status_code=503, detail="demo requests unavailable") from None


class TooMany(Exception):
    pass


def save_request(
    connection: psycopg.Connection[Any], body: DemoRequestBody, source: str, agent: str
) -> DemoRequestReceipt:
    if body.website.strip():
        # A filled honeypot is a bot: answer as if it worked, store nothing.
        return DemoRequestReceipt(id=UUID(int=0), received=True)
    name = clean_line(body.name, 200)
    email = clean_line(body.email, 200).lower()
    firm = clean_line(body.firm, 200)
    message = clean_text(body.message, 2000).text
    if not name:
        raise ValueError("a name is required")
    if _EMAIL.fullmatch(email) is None:
        raise ValueError("a work email is required")
    if contains_secret({"name": name, "firm": firm, "message": message}):
        raise ValueError("the message looks like it contains a credential; leave it out")
    with transaction(connection) as cursor:
        recent = cursor.execute(
            """
            SELECT count(*) FROM demo_requests
            WHERE created_at > clock_timestamp() - interval '1 hour'
              AND (lower(email) = %s OR (source_ip <> '' AND source_ip = %s))
            """,
            (email, source[:64]),
        ).fetchone()
        if recent is not None and int(recent[0]) >= HOURLY_LIMIT:
            raise TooMany()
        row = cursor.execute(
            """
            INSERT INTO demo_requests (name, email, firm, message, source_ip, user_agent)
            VALUES (%s, %s, %s, %s, %s, %s)
            RETURNING id
            """,
            (name, email, firm, message, source[:64], agent[:300]),
        ).fetchone()
    assert row is not None
    return DemoRequestReceipt(id=UUID(str(row[0])))


LIBRARY_PATH = "/public/library-summary"


class LibrarySummary(BaseModel):
    version: int
    controls: int
    areas: int
    agents: int


def register_library_summary(app: FastAPI) -> None:
    """The landing page's library figures, read from the library itself so they never
    drift from what an engagement loads. Public: it says nothing about any client."""
    from ai_workforce_api.controls import LIBRARY, LIBRARY_VERSION
    from ai_workforce_api.workforce import STANDARD_KEYS

    @app.get(LIBRARY_PATH)
    def library_summary() -> LibrarySummary:
        return LibrarySummary(
            version=LIBRARY_VERSION,
            controls=len(LIBRARY),
            areas=len({control.domain for control in LIBRARY}),
            agents=len(STANDARD_KEYS),
        )
