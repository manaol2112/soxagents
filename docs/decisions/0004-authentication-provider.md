# ADR 0004: Authentication provider

## Status

Accepted

## Context

Authenticated routes must use an established OIDC provider and server-side sessions. The platform also uses a Microsoft 365 shared mailbox. Milestone 2.3 implements login. The provider has to be chosen before that work starts.

## Decision

Production authentication uses Microsoft Entra ID as the OIDC issuer, in the same Microsoft 365 tenant as the shared mailbox.

The API stores no passwords. Sessions are server-side. Tokens are not logged. `OIDC_CLIENT_SECRET` stays empty in `.env.example` and is supplied only through the environment at deployment. Local development and CI do not embed a client secret. The Entra SDK is added in Milestone 2.3, not before. Authorization remains a separate policy in Milestone 2.4.

## Consequences

- Login uses the authorization-code flow against Entra ID.
- A different issuer requires a revision of this record.
- Milestone 2.3 stores hashed server-side sessions, expires them, and protects routes by default.
- Milestone 2.4 checks roles separately from the session. See [authorization.md](../authorization.md).
- Milestone 6.1 records mail in a mock mailbox. Microsoft Graph is not called, and live send stays disabled.
- Milestone 6.2 keeps the Graph tenant, application id, client secret, and shared mailbox address in the environment. The secret is not logged. Live send stays disabled. See [mailbox.md](../mailbox.md).
