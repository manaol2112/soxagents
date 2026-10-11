# Shared mailbox configuration

Milestone 6.2 records how the platform will use one Microsoft 365 shared mailbox. It does not call Microsoft Graph, and it does not send mail. The running provider remains the mock from Milestone 6.1.

## Dedicated mailbox

Use one shared mailbox for evidence requests. Put its address in `SHARED_MAILBOX_ADDRESS`. The platform may use only that address. A different mailbox address is rejected.

## Application registration

Create an application registration in the same Entra tenant as the mailbox. Use application permissions, not a user password.

Minimum permissions:

- `Mail.Send`
- `Mail.Read`

Do not grant organization-wide mailbox permissions such as `Mail.ReadWrite` or `Mail.Send` for every mailbox. Restrict the application to the one shared mailbox with an Exchange Online application access policy.

Grant admin consent for those two permissions. Record the tenant id in `GRAPH_TENANT_ID` and the application id in `GRAPH_CLIENT_ID`.

## Credentials

Store the client secret in `GRAPH_CLIENT_SECRET` through the environment or the deployment secret store. Do not commit it, and do not put it in a fixture. The API does not write the secret to the database, the health response, the configuration response, or a log line.

Leave `EMAIL_PROVIDER` empty locally. A value of `graph` marks the provider unavailable. The mock is the only provider that records a message.

## Tokens

This milestone does not request an access token. When a later milestone adds Graph, it must use the client-credentials flow, keep the token in memory, and refresh it before it expires. Tokens are not logged and are not stored in PostgreSQL.

## Permission review

Review the app registration, the admin consent, and the application access policy on a regular schedule. Rotate the client secret in the secret store and remove the previous secret after the new one is in use.

## Live send

`EMAIL_LIVE_SEND_ENABLED` stays `false`. `GET /health` reports `live_email_enabled: false` even when the flag and the Graph values are all set. `GET /mailbox/configuration` reports whether the four Graph values are present. It does not return the mailbox address, the tenant id, the application id, or the secret. A signed-in caller can read that status. An anonymous caller cannot.

`EMAIL_ALLOWED_RECIPIENT_DOMAINS` optionally limits evidence requests to a comma-separated list of exact recipient domains. The shared mailbox can never be a recipient. See `docs/pbc.md` for how requests are sent and tracked.
