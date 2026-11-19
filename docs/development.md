# Development setup

Milestone 1.4 adds formatting, linting, type checking, smoke tests, and CI. The API serves identity and authorization. The web app serves the workspace shell.

## Prerequisites

- Git
- Node.js 24.21.0 (Active LTS). A newer Current release, including Node.js 26, does not satisfy the pin.
- pnpm 12.10.1
- uv 0.13.0, which installs Python 3.14.8 for this repository
- Docker with Compose v2
- Tesseract OCR 5, which reads screenshots and scanned pages of evidence on the server. It is a system program, not a Python or Node package, so `make install` installs it, with each `OCR_LANGUAGES` language, when it is missing (`scripts/tesseract.sh`: winget on Windows, where an administrator prompt appears; Homebrew on macOS; on Linux apt-get, dnf or yum, apk, pacman or zypper, through sudo when not root), and `make check` fails without it. Tested on 17 November 2026 from clean images of Ubuntu 24.04, Debian 12, Fedora 42, Alpine 3.21, Arch and openSUSE Leap 15.6. RHEL, Rocky and Alma 9 offer only Tesseract 4.1 and Amazon Linux 2023 none: there the script stops with that explanation, and the API needs another distribution, a container, or Tesseract built from source. Only the machine that runs the API needs it; people using the workspace install nothing. The app finds it on the `PATH` or, on Windows, in `%ProgramFiles%\Tesseract-OCR`; set `OCR_TESSERACT_PATH` only for another location, quoted because `.env` is read by bash: `OCR_TESSERACT_PATH='C:/Tools/Tesseract-OCR/tesseract.exe'`. Without it, the API warns at startup and every screenshot or scan waits for a person to read it, unless the firm uses model OCR.

Install the pinned tools:

```bash
# Node.js 24.21.0 from https://nodejs.org/dist/v24.21.0/
npm install -g pnpm@12.10.1
curl -LsSf https://astral.sh/uv/0.13.0/install.sh | sh
```

Restart the shell after installing uv so `uv` is on `PATH`.

## First-time setup

1. Clone this repository.
2. Confirm you are on a working branch and that `git status` is clean of secrets.
3. Install the pinned toolchain above.
4. From the repository root:

```bash
make check
make install
```

`make install` uses the committed lockfiles. It does not upgrade packages.

Copy the environment template and set a local database password. `.env` is ignored by Git.

```bash
cp .env.example .env
```

Generate a database password on this machine. Do not copy a shared password into `.env` or into CI.

```bash
openssl rand -hex 24
```

Put that value in both `POSTGRES_PASSWORD` and the password portion of `DATABASE_URL`:

```text
POSTGRES_USER=postgres
POSTGRES_PASSWORD=<generated>
POSTGRES_DB=ai_workforce
POSTGRES_PORT=5432
DATABASE_URL=postgresql://postgres:<generated>@127.0.0.1:5432/ai_workforce
```

If port 5432 is already taken on the machine, pick a free host port and use that same port in `POSTGRES_PORT` and `DATABASE_URL`.

Use `127.0.0.1`, not `localhost`, as the host. Compose publishes PostgreSQL on 127.0.0.1 only, and on Windows `localhost` is tried as `::1` first, which made every connection take several seconds and signed-in pages show "Workspace unavailable". The API and the tests point a `localhost` URL at 127.0.0.1 themselves (`loopback_database_url` in `services/api/ai_workforce_api/settings.py`), so an older `.env` keeps working.

Leave the other placeholders empty. `EMAIL_LIVE_SEND_ENABLED` stays `false`.

Start PostgreSQL and Temporal, then wait until their health checks pass:

```bash
make start
make status
make test
```

`make start` and `make stop` keep the named volume `ai_workforce_postgres_data`. `make reset` deletes that volume and the local database. Startup never removes it.

`make api` serves `http://127.0.0.1:8000`. `GET /health` reports whether live email is enabled. `GET /ready` stays unavailable until PostgreSQL accepts a query.

`GET /auth/login` starts Microsoft Entra ID login when `OIDC_ISSUER_URL`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`, and `OIDC_REDIRECT_URL` are all set. Leave them empty locally. The API then reports that login is not configured and does not call Microsoft. A successful callback sets the `HttpOnly` cookie `aw_session`. Other routes require that cookie. `POST /auth/logout` revokes the session. Organization and project routes then check the caller's active membership. See [authorization.md](authorization.md). `SESSION_COOKIE_SECURE` defaults to true; local HTTP tests set it to false. Do not put a client secret in the repository.

A sign-in finishes only in the browser that started it: the start sets the short-lived `HttpOnly` cookie `aw_login` (path `/auth`), whose hash the login attempt keeps, and a callback without it is refused. Because a sign-in links to the account already on file for its email, a Microsoft email must be one Microsoft vouches for. With a tenant-specific `OIDC_ISSUER_URL` (`https://login.microsoftonline.com/<tenant id>/v2.0`), the token must come from that tenant (its `tid`), and the email is the user name (`preferred_username`), or the `email` claim only with `xms_edov` true. The tenant must be named by its directory id: a domain-named tenant (`contoso.onmicrosoft.com`) is refused when the API starts. With a multi-tenant one (`common`, `organizations`, `consumers`), the token must carry the `email` claim with the optional claim `xms_edov` true, so add `email` and `xms_edov` as optional ID-token claims in the app registration; the user name is never taken as the email there.

`GET /auth/google/login` starts Google sign-in when `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `GOOGLE_REDIRECT_URL` are all set (`/auth/google/callback` on the API). The flow uses PKCE and a nonce, and the ID token is verified against Google's published keys; only an address Google reports as verified can sign in. `GET /auth/providers` lists the providers that are configured, and the web app's `/sign-in` page shows a button for each. The first time a person signs in through either provider and belongs to no organization, the API creates a workspace for them and makes them its owner: named after the email domain ("Firm" for `dana@firm.example`), or "Dana's workspace" for a personal mailbox. The same verified email through Google and Microsoft is one user (table `user_identities`); a second account from the same provider for that email is refused. A failed sign-in returns to `/sign-in?notice=...` when `APP_BASE_URL` is set. See [decisions/0009-google-sign-in.md](decisions/0009-google-sign-in.md).

`make web` serves the workspace at `http://localhost:3000`. It reads the signed-in user from the API. When `API_BASE_URL` is empty, the web app calls `http://127.0.0.1:8000`. Start `make api` in another terminal as well. Open `http://localhost:3000`, not a different host or port. The two processes have to be running; the pages are not part of the editor.

Microsoft and Google sign-in stay unavailable until their values are set. For a private machine, `PREVIEW_LOGIN_ENABLED=true` allows `http://localhost:8000/auth/preview`. That route answers only on localhost, creates a preview owner and sample project, and returns to the workspace. Leave the flag false in shared or deployed environments. A visitor without a session who opens the bare address sees the landing page at `/welcome`, with `/sign-in` for the configured providers. Any other workspace address opened while signed out (no session, or one the API no longer knows: expired or revoked) redirects to `/sign-in?next=<that address>`, and signing in (either provider, or the preview) lands on it; the return is kept only when it is a workspace address on the web app (`/` or `/?...` in printable ASCII with no backslash, at most 2000 characters), checked by the web app and again by the API, and anything else lands on the workspace home (19 November 2026). A form or a page change made after the session ended takes the same path; an in-place edit keeps what was typed and says to sign in again in another tab, which then returns to the same page. A member with no organization sees the empty state. If the API cannot be reached, the page reports that the workspace is unavailable. The Projects section creates and edits projects for owners, admins, and project managers. Reviewers and contributors can open projects they belong to and cannot change them. The Agents section registers definitions for the same three roles. Every member can read them. A model field is a name, and the form rejects secret values. Disabling a definition stops new work and leaves a running execution on the revision it started with. The Tasks section is for the selected project. Owners, admins, project managers, and contributors who belong to that project can create and change tasks. Reviewers can read them. A cancelled task needs Reactivate before it can move again. The overview lists blocked tasks and open deadlines for the selected project. Task and agent filters live in the page address, so a refresh keeps the same page. Workflow runs are available through the API. `make start` also starts Temporal on port 7233. Set `WORKFLOW_PROVIDER=temporal` and `WORKFLOW_ADDRESS=localhost:7233` to submit new runs to it. Leave the address empty to keep execution in PostgreSQL only. Model calls use the local adapter when `MODEL_PROVIDER` is empty, `mock`, or `local`, and no provider key is required. `MODEL_PROVIDER=anthropic` with `MODEL_API_KEY` connects Claude (`MODEL_NAME` defaults to `claude-sonnet-5-5`); the key stays in `.env` and is never logged. Any other provider name is refused. After a kickoff, the evidence coordinator drafts each PBC request in the background: through Temporal when `WORKFLOW_ADDRESS` is set, otherwise on the API's own worker threads when `LOCAL_WORKER_ENABLED=true` (`LOCAL_WORKER_THREADS`, default 6, is how many run at once; each draft is one model call of a few seconds, so the count sets how long a launch's drafting takes). Without Claude it drafts with rules. See [pbc.md](pbc.md#drafting-from-the-control). The manager agent uses that adapter to propose a plan. The local adapter does not invent task titles, so an unscripted plan asks for clarification instead of creating tasks. A worker result records a versioned handoff for a task that is already underway. Submitting it does not change the task or run the proposed action. A failed predecessor blocks the next task from starting. A repeated workflow key does not create a second run, and a retry stops when its attempt limit is reached. A worker crash is reconciled to one effect row. The action catalog lists registered operations and checks a proposal's fields. That check does not perform the operation. The policy engine separately allows or denies the same proposal. An owner can deny an action for the organization or for one project. An approval stores the exact parameters and does not perform the action. Changing a recipient requires a new approval. Execution runs only after the policy allows the action and, when required, an unexpired approval matches those parameters. A repeated execution does not repeat the effect, and a concurrent repeat returns the same outcome. Mail actions record a mock mailbox message and do not contact a provider. Leave `EMAIL_PROVIDER` empty. Graph mailbox settings are documented in [mailbox.md](mailbox.md). A PBC request records an evidence request and its status. Changing that status does not send mail. Live email stays disabled.

## Commands

| Command | Purpose |
| --- | --- |
| `make toolchain` | Print the pinned Node.js, pnpm, Python, and uv versions |
| `make check` | Exit non-zero if the local toolchain does not match the pins |
| `make install` | Install from `pnpm-lock.yaml` and `uv.lock` |
| `make start` | Start PostgreSQL, Temporal, and MinIO, wait for the database and Temporal health checks, and apply migrations |
| `make awake` | Windows only: keep the machine from sleeping while it runs (`scripts/stay-awake.ps1`). `HOURS=72` stops after 72 hours; Ctrl+C stops earlier. Lid-close sleep is turned off while it runs and put back after, where the power plan has a lid setting |
| `make go` | Everything after a restart: `make start`, then the API and the web app together in one terminal. Ctrl+C stops the API and the web app; the Docker services keep running |
| `make migrate` | Apply migrations and sync the standard workforce. This does not delete data. Production deploys run the same step: `python -m ai_workforce_api.migrate` |
| `make stop` | Stop PostgreSQL and keep its data |
| `make status` | Show whether PostgreSQL is running and healthy |
| `make env-status` | One line per API or web server listening on the development and scratch ports (`ENV_PORTS=8000,3000,8030-8050` to choose): the checkout it serves, its branch, commit, uncommitted files and commits behind `origin/main` (as of the last fetch), and an API's database name, never its URL. An API with `GET /health/version` also shows the commit it loaded and its database's latest migration; "(older code)" means a reload did not happen (`scripts/env_status.py`, read only) |
| `make format` | Format Python and the TypeScript sources |
| `make lint` | Fail if formatting or lint rules fail |
| `make typecheck` | Run mypy and `tsc --noEmit` |
| `make api` | Run the API at `http://127.0.0.1:8000` |
| `make web` | Run the workspace at `http://127.0.0.1:3000` |
| `make test` | Run smoke tests, then `SELECT 1` against PostgreSQL |
| `make ci` | Run `make lint`, `make typecheck`, and `make test` |
| `make reset` | Delete the local PostgreSQL volume |

JavaScript packages use pnpm. Python packages use uv. Do not add dependencies with npm or pip.

## What not to commit

- `.env` and any real credentials, tokens, keys, or mailbox secrets
- Client evidence, workpapers, or exports from a real engagement
- Dependency directories, build output, coverage reports, and local database volumes

## Checks

Reproduce the CI job locally after `make check` and `make install`:

```bash
make ci
```

That runs lint, type checking, the smoke tests, and the PostgreSQL query. `.github/workflows/ci.yml` runs the same commands on Ubuntu with the pinned Node.js, pnpm, uv, and Python versions. Each CI run generates its own database password, masks that password in the log, and does not receive production credentials.
