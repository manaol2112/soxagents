# ADR 0003: Agent orchestration

## Status

Accepted

## Context

The build plan allows LangGraph or a smaller provider-neutral orchestration layer, and only if it adds real value. Models propose plans. Deterministic code validates permissions and performs approved side effects.

## Decision

Orchestration stays a small provider-neutral layer in this repository. LangGraph is not a dependency.

The layer may call the model adapter from Milestone 4.3 and the workflow interface from Milestone 4.1. It may not execute tools, send email, or change permissions. If Milestone 4.4 cannot meet its acceptance criteria without an external library, that change requires a revision of this record.

## Consequences

- No agent framework is installed. Milestone 4.4 keeps the manager in this repository. Milestone 4.5 records a versioned worker result in this repository and does not execute the proposed actions. Milestone 5.1 registers the action catalog and does not execute a listed action. Milestone 5.2 decides allow or deny in this repository and does not let a model certify that an action is safe. Milestone 5.3 stores an approval for the exact parameters and does not execute the action. Milestone 5.4 performs an internal effect only after the policy and an exact approval allow it, and it does not send email. Milestone 5.5 proves an agent, a closed approval, missing policy data, and a duplicate submission cannot bypass that path.
- Model output remains untrusted input to deterministic code.
- A later library adoption cannot bypass the policy and approval path.
