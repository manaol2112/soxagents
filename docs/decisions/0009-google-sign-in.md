# ADR 0009: Google sign-in and self-serve sign-up

## Status

Accepted. Revises [ADR 0004](0004-authentication-provider.md).

## Context

ADR 0004 chose Microsoft Entra ID as the only OIDC issuer, which suits a firm whose people already live in one Microsoft 365 tenant. The public landing page now invites firms the platform has never met. They need a way to sign up without an app registration, and many of them sign in with Google. ADR 0004 states that a different issuer requires a revision of that record.

## Decision

Google is a second OpenID Connect issuer, next to Entra ID. Both use the authorization-code flow with server-side sessions; nothing about sessions, cookies, or authorization changes.

- Google's flow uses PKCE and a nonce. The ID token is verified against Google's published keys for signature, issuer, audience, and expiry, and only an address Google reports as verified can sign in. Access and refresh tokens are discarded and never logged.
- A user may hold one identity per issuer (`user_identities`). The same verified email through both providers is one user. A second account from the same provider for an email already on file is refused.
- The first time a person signs in through either provider and belongs to no organization, the API creates a workspace and makes them its owner. The workspace is named after the firm's email domain, or after the person for a personal mailbox. Nobody else is added; invitations stay with the membership routes.
- `GET /auth/providers` says which providers are configured, so the sign-in page offers only those.
- `GOOGLE_CLIENT_SECRET` stays empty in `.env.example` and is supplied through the environment at deployment.

## Consequences

- Self-serve sign-up exists: a new firm can create a workspace from the landing page without an administrator.
- A workspace created this way starts empty; the owner sets up engagements and invites members themselves.
- The shared mailbox remains in the Microsoft 365 tenant; Google sign-in does not change mail.
- A third issuer is another revision of this record and another value in the `user_identities.issuer` check.
