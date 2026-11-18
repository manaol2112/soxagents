#!/usr/bin/env bash
# `make reset`: deletes the Compose stack's data volumes. Every local database (all
# engagements, evidence, audit events) and the local object store go with them, and there
# is no undo. It therefore refuses unless each of these holds:
#
# 1. CONFIRM=delete-local-data is given.
# 2. APP_ENV is a development environment (development, dev, local, test). Anywhere else,
#    including an unset APP_ENV, ALLOW_NON_DEV_RESET must also name the POSTGRES_DB.
# 3. When an S3 bucket is configured, ACCEPT_OBJECT_STORE_LOSS=yes is given: the local
#    object-store volume is deleted too and is not backed up.
# 4. A backup of every database (test databases aside) was written first
#    (scripts/backup.sh). SKIP_BACKUP=yes leaves this out, deliberately.
#
# RESET_DRY_RUN=1 stops before the deletion and prints the command instead.
set -uo pipefail
export MSYS_NO_PATHCONV=1

read -r -a compose <<<"${COMPOSE:-docker compose}"
here=$(cd "$(dirname "$0")" && pwd)

env_value() {
  local key=$1 value="${!1:-}"
  if [[ -z "$value" && -f .env ]]; then
    value=$(grep -E "^${key}=" .env | tail -1 | cut -d= -f2- | tr -d '\r' |
      sed -e "s/^'\(.*\)'$/\1/" -e 's/^"\(.*\)"$/\1/')
  fi
  printf '%s' "$value"
}

refuse() {
  echo "Reset refused: $1" >&2
  echo "Nothing was deleted." >&2
  exit 1
}

environment=$(env_value APP_ENV)
database=$(env_value POSTGRES_DB)

echo "make reset deletes ALL local data: every PostgreSQL database in the volume"
echo "ai_workforce_postgres_data and the object store in ai_workforce_minio_data."

[[ "${CONFIRM:-}" == "delete-local-data" ]] ||
  refuse "run it as: make reset CONFIRM=delete-local-data"

case "$environment" in
  development | dev | local | test) ;;
  *)
    [[ -n "$database" && "${ALLOW_NON_DEV_RESET:-}" == "$database" ]] ||
      refuse "APP_ENV is '${environment:-unset}', not a development environment. If this is truly intended, also give ALLOW_NON_DEV_RESET=<the POSTGRES_DB name>."
    ;;
esac

if [[ -n "$(env_value S3_BUCKET)" && "${ACCEPT_OBJECT_STORE_LOSS:-}" != "yes" ]]; then
  refuse "an object store is configured and its local volume would be deleted without a backup. Copy the bucket first, then also give ACCEPT_OBJECT_STORE_LOSS=yes."
fi

if [[ "${SKIP_BACKUP:-}" == "yes" ]]; then
  echo "SKIP_BACKUP=yes: no backup is taken."
else
  # shellcheck disable=SC2016
  names=$("${compose[@]}" exec -T postgres sh -c 'psql -X -q -A -t -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d postgres -c "$1"' sh \
    "SELECT datname FROM pg_database WHERE NOT datistemplate AND datname <> 'postgres' AND datname !~ '^ai_workforce_(test|tpl)_' ORDER BY 1" |
    tr -d '\r') || names=""
  [[ -n "$names" ]] || refuse "the databases could not be listed, so no backup could be taken."
  for name in $names; do
    DB="$name" bash "$here/backup.sh" backup >/dev/null ||
      refuse "the backup of $name failed."
    echo "Backed up $name."
  done
  echo "Backups are in ${BACKUP_DIR:-backups}/."
fi

if [[ "${RESET_DRY_RUN:-}" == "1" ]]; then
  echo "Dry run: would now run: ${compose[*]} down -v --remove-orphans"
  exit 0
fi

"${compose[@]}" down -v --remove-orphans
