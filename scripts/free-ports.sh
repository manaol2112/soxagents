#!/usr/bin/env bash
# Frees the dev servers' ports before `make go` starts them again.
#
# On Windows, Ctrl+C in `make go` stops the shell but often not the Python and Node
# processes it started, so they keep holding ports 8000 and 3000 and the next start fails
# on a port in use. This stops such a leftover server: only Python or Node (this project's
# API and web app); anything else on the port stops the start with its name, so nothing
# unrelated is ever killed.
#
# Usage: scripts/free-ports.sh PORT [PORT...]
set -uo pipefail

status=0

listeners() {
  local port=$1
  if [[ "${OS:-}" == "Windows_NT" ]]; then
    # Proto, Local Address, Foreign Address, State, PID; IPv4 and IPv6.
    netstat -ano | tr -d '\r' | awk -v suffix=":${port}" \
      '$1 ~ /^TCP/ && $4 == "LISTENING" && substr($2, length($2) - length(suffix) + 1) == suffix { print $5 }' |
      sort -u
  else
    lsof -nP -t -iTCP:"${port}" -sTCP:LISTEN 2>/dev/null | sort -u
  fi
}

name_of() {
  local pid=$1
  if [[ "${OS:-}" == "Windows_NT" ]]; then
    tasklist //FI "PID eq ${pid}" //FO CSV //NH 2>/dev/null | tr -d '\r' | head -1 | cut -d, -f1 | tr -d '"'
  else
    ps -p "${pid}" -o comm= 2>/dev/null | xargs basename 2>/dev/null
  fi
}

stop() {
  local pid=$1
  if [[ "${OS:-}" == "Windows_NT" ]]; then
    taskkill //PID "${pid}" //T //F >/dev/null 2>&1
  else
    kill "${pid}" 2>/dev/null
  fi
}

for port in "$@"; do
  for pid in $(listeners "${port}"); do
    [[ -z "${pid}" || "${pid}" == "0" ]] && continue
    name=$(name_of "${pid}")
    case "$(printf '%s' "${name}" | tr '[:upper:]' '[:lower:]')" in
      python.exe | python | python3 | python3.* | node.exe | node)
        echo "Port ${port}: stopping ${name} (PID ${pid}), left running by an earlier start."
        stop "${pid}"
        ;;
      *)
        echo "Port ${port} is in use by ${name:-PID ${pid}}, which is not this project's server. Stop it, then run make go again." >&2
        status=1
        ;;
    esac
  done
done

# Wait for the ports to be released (up to 10 seconds).
for port in "$@"; do
  for _ in $(seq 1 20); do
    [[ -z "$(listeners "${port}")" ]] && break
    sleep 0.5
  done
  if [[ -n "$(listeners "${port}")" ]]; then
    echo "Port ${port} is still in use." >&2
    status=1
  fi
done

exit "${status}"
