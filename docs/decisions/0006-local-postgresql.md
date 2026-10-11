# ADR 0006: Local PostgreSQL

## Status

Accepted

## Context

Milestone 1.3 needs a reproducible database for local development. Later milestones will store business records in PostgreSQL. Workflow servers and object storage stay deferred.

## Decision

- Run PostgreSQL **18.6** from the official `postgres:18.6` image. Do not use a floating `latest` tag.
- Start it with Docker Compose. Publish the host port from `POSTGRES_PORT` in `.env`, defaulting to 5432.
- Require `POSTGRES_USER`, `POSTGRES_PASSWORD`, and `POSTGRES_DB` from `.env`. Compose fails if any of them is empty. Those values are not committed.
- Persist data in the named volume `ai_workforce_postgres_data`, mounted at `/var/lib/postgresql` (the PostgreSQL 18 image volume).
- `make start` and `make stop` leave that volume in place. `make reset` is the only command that deletes it.
- Wait for the image health check via `docker compose up --wait`. Do not use a fixed sleep.
- Do not add Temporal, MinIO, or other services in this milestone.

## Consequences

- The first startup initializes an empty database. Later startups reuse the volume.
- Changing the database user, database name, or major PostgreSQL version on an existing volume needs `make reset` or a planned upgrade. Reset deletes local data.
- Application migrations are not part of this milestone.
