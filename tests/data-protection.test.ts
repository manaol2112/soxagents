import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

// Governance, 17 November 2026 (assessment D1, D2): `make reset` deleted every local
// database without asking, and no backup existed. These tests hold the guard. They can
// never delete anything: the Docker command is a fake that only records its arguments,
// and the one case that reaches the deletion also runs with RESET_DRY_RUN=1.

const root = join(import.meta.dirname, "..");
const bash =
  process.platform === "win32" ? "C:/Program Files/Git/bin/bash.exe" : "bash";
const usable = process.platform !== "win32" || existsSync(bash);

function run(script: string, args: string[], env: Record<string, string>) {
  const dir = mkdtempSync(join(tmpdir(), "aw-reset-"));
  const log = join(dir, "compose.log").replaceAll("\\", "/");
  const fake = join(dir, "fake-compose.sh").replaceAll("\\", "/");
  // The fake answers the database listing with one name and fails every dump.
  writeFileSync(
    fake,
    `#!/usr/bin/env bash\necho "$*" >> "${log}"\ncase "$*" in *pg_database*) echo ai_workforce ;; *pg_dump*) exit 1 ;; esac\n`,
  );
  chmodSync(fake, 0o755);
  const result = spawnSync(bash, [join(root, "scripts", script), ...args], {
    cwd: dir, // no .env here: only the variables below are read
    encoding: "utf8",
    env: {
      PATH: process.env.PATH ?? "",
      COMPOSE: `bash ${fake}`,
      BACKUP_DIR: join(dir, "backups").replaceAll("\\", "/"),
      ...env,
    },
  });
  const calls = existsSync(log) ? readFileSync(log, "utf8") : "";
  return { status: result.status, text: result.stdout + result.stderr, calls };
}

const dev = { APP_ENV: "development", POSTGRES_DB: "ai_workforce" };

describe("make reset never deletes data by accident", { skip: !usable }, () => {
  it("refuses without CONFIRM, and says what would be lost", () => {
    const out = run("reset.sh", [], dev);
    assert.equal(out.status, 1);
    assert.match(out.text, /deletes ALL local data/);
    assert.match(out.text, /CONFIRM=delete-local-data/);
    assert.match(out.text, /Nothing was deleted\./);
    assert.equal(out.calls, "");
  });

  it("refuses a wrong CONFIRM word", () => {
    const out = run("reset.sh", [], { ...dev, CONFIRM: "yes" });
    assert.equal(out.status, 1);
    assert.equal(out.calls, "");
  });

  it("refuses outside development, and with APP_ENV unset, without the second safeguard", () => {
    for (const environment of ["production", "staging", ""]) {
      const out = run("reset.sh", [], {
        APP_ENV: environment,
        POSTGRES_DB: "ai_workforce",
        CONFIRM: "delete-local-data",
        SKIP_BACKUP: "yes",
      });
      assert.equal(out.status, 1, environment);
      assert.match(out.text, /not a development environment/);
      assert.doesNotMatch(out.calls, /down/);
    }
  });

  it("refuses when an object store is configured and its loss is not accepted", () => {
    const out = run("reset.sh", [], {
      ...dev,
      CONFIRM: "delete-local-data",
      SKIP_BACKUP: "yes",
      S3_BUCKET: "evidence",
    });
    assert.equal(out.status, 1);
    assert.match(out.text, /object store/);
    assert.doesNotMatch(out.calls, /down/);
  });

  it("deletes nothing when the backup fails", () => {
    const out = run("reset.sh", [], { ...dev, CONFIRM: "delete-local-data" });
    assert.equal(out.status, 1);
    assert.match(out.text, /the backup of ai_workforce failed/);
    assert.match(out.calls, /pg_database/);
    assert.doesNotMatch(out.calls, /down/);
  });

  it("reaches the deletion only with every safeguard met (dry run)", () => {
    const out = run("reset.sh", [], {
      ...dev,
      CONFIRM: "delete-local-data",
      SKIP_BACKUP: "yes",
      RESET_DRY_RUN: "1",
    });
    assert.equal(out.status, 0);
    assert.match(
      out.text,
      /Dry run: would now run: .* down -v --remove-orphans/,
    );
    assert.doesNotMatch(out.calls, /down/);
  });
});

describe("a restore never overwrites", { skip: !usable }, () => {
  it("refuses a missing file and a missing or unsafe target name", () => {
    assert.match(
      run("backup.sh", ["restore"], { FILE: "nope.dump", TARGET: "copy" }).text,
      /There is no backup file/,
    );
    const here = join(root, "Makefile").replaceAll("\\", "/");
    for (const target of ["", "Bad-Name", "x; drop database y"]) {
      const out = run("backup.sh", ["restore"], { FILE: here, TARGET: target });
      assert.equal(out.status, 1, target);
      assert.match(out.text, /Name a new database/);
      assert.equal(out.calls, "");
    }
  });

  it("the scripts hold the rules they are documented by", () => {
    const backup = readFileSync(join(root, "scripts", "backup.sh"), "utf8");
    // The only dropdb is behind the scratch-name check; sessions are never dumped.
    assert.equal(backup.match(/dropdb/g)?.length, 1);
    assert.match(
      backup,
      /_restorecheck_\[0-9\]\+\$ \]\]; then\s+# shellcheck[^\n]*\n\s+pg sh -c 'dropdb/,
    );
    assert.match(
      backup,
      /EXCLUDED_DATA=\(auth_sessions evidence_portal_sessions evidence_portal_codes\)/,
    );
    const makefile = readFileSync(join(root, "Makefile"), "utf8");
    assert.doesNotMatch(makefile, /down -v/);
  });
});
