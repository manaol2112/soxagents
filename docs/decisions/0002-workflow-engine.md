# ADR 0002: Workflow engine

## Status

Accepted

## Context

Long-running audit work needs durable timers, retries, and recovery after process restarts. The build plan allows Temporal or another reviewed durable workflow engine. Leaving the choice open lets later code pick a client incidentally.

## Decision

Temporal is the durable workflow engine.

Business modules do not import the Temporal SDK. Milestone 4.1 defines the application workflow interface. Milestone 4.2 adds the Temporal server and the adapter behind that interface. Compose does not start Temporal before that milestone.

## Consequences

- Phases 2 and 3 store business state in PostgreSQL only.
- Milestone 4.2 starts Temporal from Compose and keeps the SDK inside the adapter. Workflow retries, timers, and reconciliation go through that adapter. Milestone 4.6 reconciles a worker crash to the effect row that was written, or to one ambiguous row when the write did not finish.
- Replacing Temporal requires a revision of this record, not a direct SDK import in agent code.
