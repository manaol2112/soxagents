#!/usr/bin/env bash
# Backup and restore of a PostgreSQL database of the local Compose stack.
#
#   scripts/backup.sh backup            DB=<name>            (default: DATABASE_URL's database)
#   scripts/backup.sh restore           FILE=<dump> TARGET=<new database name>
#   scripts/backup.sh verify            DB=<name>            backup, restore into a scratch
#                                                            database, compare, drop the scratch
#
# Safety rules, on purpose:
# - A restore only ever goes into a database that does not exist yet. Nothing is overwritten
#   or dropped. To use a restored copy, point DATABASE_URL at it (docs/operations.md).
# - The only database this script drops is the scratch one `verify` itself created, whose
#   name ends in _restorecheck_<digits>.
# - Session and one-time-code tables are dumped without their rows: a backup holds no
#   sign-in session, and everyone signs in again after a restore.
# - No password is passed on a command line or printed: the tools run inside the postgres
#   container with its own POSTGRES_USER.
#
# What a backup is NOT: it is an unencrypted file of engagement data on this disk
# (BACKUP_DIR, default backups/, git-ignored). It does not contain .env, and it does not
# contain evidence files held in an S3 bucket (it does when no bucket is configured, since
# the bytes are then rows of this database). Copy it somewhere safe yourself.
set -uo pipefail
export MSYS_NO_PATHCONV=1

read -r -a compose <<<"${COMPOSE:-docker compose}"
BACKUP_DIR=${BACKUP_DIR:-backups}
# Rows left out of every dump: sign-in sessions and one-time codes.
EXCLUDED_DATA=(auth_sessions evidence_portal_sessions evidence_portal_codes)
LAST_BACKUP=""

# A setting from the environment, else from .env (read, never sourced or printed).
env_value() {
  local key=$1 value="${!1:-}"
  if [[ -z "$value" && -f .env ]]; then
    value=$(grep -E "^${key}=" .env | tail -1 | cut -d= -f2- | tr -d '\r' |
      sed -e "s/^'\(.*\)'$/\1/" -e 's/^"\(.*\)"$/\1/')
  fi
  printf '%s' "$value"
}

valid_name() { [[ "$1" =~ ^[a-z][a-z0-9_]{0,62}$ ]]; }

current_db() {
  local url name
  url=$(env_value DATABASE_URL)
  name=${url##*/}
  printf '%s' "${name%%\?*}"
}

fail() {
  echo "$1" >&2
  exit 1
}

pg() { "${compose[@]}" exec -T postgres "$@"; }

# One query's rows, unaligned, from a database.
sql() {
  pg sh -c 'psql -X -q -A -t -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$1" -c "$2"' sh "$1" "$2" |
    tr -d '\r'
}

database_exists() { [[ "$(sql postgres "SELECT 1 FROM pg_database WHERE datname = '$1'")" == "1" ]]; }

backup() {
  local db=${DB:-$(current_db)} out excludes="" table
  valid_name "$db" || fail "Name the database: DB=<name> (lower-case letters, digits, underscores)."
  database_exists "$db" || fail "There is no database named $db."
  for table in "${EXCLUDED_DATA[@]}"; do
    excludes+=" --exclude-table-data=public.$table"
  done
  mkdir -p "$BACKUP_DIR"
  umask 077
  out="$BACKUP_DIR/$db-$(date -u +%Y%m%dT%H%M%SZ).dump"
  # shellcheck disable=SC2016
  if ! pg sh -c 'exec pg_dump -U "$POSTGRES_USER" -d "$1" -Fc --no-owner --no-acl'"$excludes" sh "$db" \
    >"$out.partial"; then
    rm -f "$out.partial"
    fail "The backup of $db failed. Nothing was written."
  fi
  # A dump that cannot be listed is not a backup.
  if [[ ! -s "$out.partial" ]] || ! pg pg_restore --list <"$out.partial" >/dev/null 2>&1; then
    rm -f "$out.partial"
    fail "The backup of $db could not be read back. Nothing was kept."
  fi
  mv "$out.partial" "$out"
  LAST_BACKUP=$out
  echo "Backup of $db written: $out ($(du -h "$out" | cut -f1))"
  if [[ -n "$(env_value S3_BUCKET)" ]]; then
    echo "Note: evidence files are in the object store, which this backup does not include."
  fi
  echo "The file is not encrypted and holds engagement data. It exists only on this disk until you copy it."
}

restore_into() {
  local file=$1 target=$2
  [[ -f "$file" ]] || fail "There is no backup file at $file."
  valid_name "$target" || fail "Name a new database: TARGET=<name> (lower-case letters, digits, underscores)."
  if database_exists "$target"; then
    fail "A database named $target already exists. A restore never overwrites: choose a new name."
  fi
  # shellcheck disable=SC2016
  pg sh -c 'createdb -U "$POSTGRES_USER" "$1"' sh "$target" || fail "The database $target could not be created."
  # shellcheck disable=SC2016
  if ! pg sh -c 'pg_restore -U "$POSTGRES_USER" -d "$1" --no-owner --no-acl --exit-on-error' sh "$target" \
    <"$file"; then
    fail "The restore into $target did not finish. $target is left as it is for inspection; it is not in use."
  fi
}

restore() {
  restore_into "${FILE:-}" "${TARGET:-}"
  echo "Restored ${FILE} into the new database ${TARGET}."
  echo "Nothing else changed. To use it, set DATABASE_URL to ${TARGET} and restart (docs/operations.md)."
}

# Every table's row count and the newest migration, as text to compare.
facts() {
  sql "$1" "SELECT table_name || '=' || (xpath('/row/c/text()', query_to_xml(format('SELECT count(*) AS c FROM %I', table_name), false, true, '')))[1]::text FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY 1" |
    grep -vE "^($(
      IFS='|'
      echo "${EXCLUDED_DATA[*]}"
    ))="
  echo "newest_migration=$(sql "$1" "SELECT max(version) FROM schema_migrations")"
}

verify() {
  local db=${DB:-$(current_db)} scratch before after
  backup
  scratch="${db:0:40}_restorecheck_$(date +%s)"
  before=$(facts "$db")
  restore_into "$LAST_BACKUP" "$scratch"
  after=$(facts "$scratch")
  if [[ "$scratch" =~ _restorecheck_[0-9]+$ ]]; then
    # shellcheck disable=SC2016
    pg sh -c 'dropdb -U "$POSTGRES_USER" "$1"' sh "$scratch" || echo "The scratch database $scratch could not be dropped."
  fi
  if [[ -z "$before" || "$before" != "$after" ]]; then
    echo "Restore check FAILED for $db: the restored copy differs." >&2
    diff <(echo "$before") <(echo "$after") | head -20 >&2
    echo "(If $db was in use during the check, run it again while idle.)" >&2
    exit 1
  fi
  echo "Restore check passed for $db: $(echo "$before" | grep -vc "^newest_migration=") tables and the newest migration match."
}

case "${1:-}" in
  backup) backup ;;
  restore) restore ;;
  verify) verify ;;
  *) fail "Usage: scripts/backup.sh backup|restore|verify" ;;
esac
