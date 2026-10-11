# ADR 0001: Runtime and package managers

## Status

Accepted

## Context

The platform will use TypeScript for the web application and Python for the API. Milestone 1.2 has to pin those runtimes and their package managers before application frameworks are added. This machine currently has Node.js 26.7.0, which is still the Current release, and Python 3.12.3.

## Decision

- Node.js **24.21.0**, the latest Active LTS patch on the 24.x line (Krypton). Node.js 26 stays out of the pin until it enters LTS on 2026-10-28.
- **pnpm 12.10.1** for JavaScript. The repository is a workspace so later packages under `apps/`, `packages/`, `services/`, and `workers/` share one lockfile.
- Python **3.14.8**. That branch is in bugfix support through October 2030. Python 3.15.0 was released on 2026-10-09 and is not selected. The system interpreter is not the project interpreter.
- **uv 0.13.0** for Python environments and `uv.lock`.

Application frameworks are not installed in this milestone. Next.js, FastAPI, and their related libraries are added only when a milestone uses them.

## Consequences

- `make check` fails when Node.js, pnpm, or uv do not match these pins.
- `package.json` sets `engine-strict` through `.npmrc`, so pnpm refuses a different Node.js version. `pnpm-workspace.yaml` sets `allowBuilds` to an empty map, so dependency build scripts stay denied until a package is explicitly allowed.
- JavaScript dependencies are locked in `pnpm-lock.yaml`. Python dependencies are locked in `uv.lock`. Both files are committed. There are no third-party dependencies yet.
- npm and pip are not the project package managers. `package-lock.json` and `yarn.lock` stay ignored.
