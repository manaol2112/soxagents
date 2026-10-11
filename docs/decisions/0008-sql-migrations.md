# ADR 0008: SQL migrations

## Status

Accepted

## Context

Milestone 2.1 requires every schema change to go through a migration. The API already uses psycopg. An ORM is not needed to establish keys, timestamps, or constraints.

## Decision

Schema changes are ordered SQL files in `migrations/`. A migration runner applies each file once, inside its own transaction, and records the filename version and SHA-256 checksum in `schema_migrations`.

- Files are named `0001_description.sql`, numbered without gaps from `0001`.
- Applied SQL is immutable. A later change is a new file.
- The runner takes a session advisory lock so two applies cannot interleave.
- Migrations are forward-only. Local recovery is `make reset`, then `make migrate`. Production recovery is restore the database backup, then apply migrations that were not in that backup.
- The runner does not print database URLs or passwords.

## Consequences

- `make migrate` is safe to run more than once.
- Editing an applied file fails the next run instead of changing a database quietly.
- Milestone 2.2 adds tables as new SQL files. It does not introduce a second migration tool.
