#!/usr/bin/env bash
# Tesseract OCR, the local engine that reads screenshots and scanned pages of evidence.
#
# Tesseract is a system program, not a Python or Node package, so `uv sync` and
# `pnpm install` cannot install it. `make install` runs this script to install it, and
# `make check` runs it to fail when it is missing. Without it, the API still starts, but
# every screenshot or scan waits for a person to read it (product owner, 17 November 2026:
# "I want that to be a requirement so that it will be installed as dependencies").
#
# Where the app finds it, in order (the same as evidence_ocr.TesseractOcr.locate):
#   1. OCR_TESSERACT_PATH, from the environment or else from .env;
#   2. `tesseract` on the PATH;
#   3. on Windows, the standard install location, %ProgramFiles%\Tesseract-OCR.
#
# Usage: scripts/tesseract.sh check|install
set -uo pipefail

MIN_MAJOR=5
mode=${1:-check}

configured_path() {
  if [[ -n "${OCR_TESSERACT_PATH:-}" ]]; then
    printf '%s' "$OCR_TESSERACT_PATH"
  elif [[ -f .env ]]; then
    # Read the one value; .env is not sourced here.
    grep -E '^OCR_TESSERACT_PATH=' .env | tail -1 | cut -d= -f2- | tr -d '\r' |
      sed -e "s/^'\(.*\)'$/\1/" -e 's/^"\(.*\)"$/\1/'
  fi
}

languages() {
  local value="${OCR_LANGUAGES:-}"
  if [[ -z "$value" && -f .env ]]; then
    value=$(grep -E '^OCR_LANGUAGES=' .env | tail -1 | cut -d= -f2- | tr -d "\r'\"")
  fi
  printf '%s' "${value:-eng}" | tr '+' ' '
}

windows_default() {
  # Git's bash passes Windows' ProgramFiles on as PROGRAMFILES.
  local base="${PROGRAMFILES:-${ProgramFiles:-C:/Program Files}}"
  printf '%s' "${base//\\//}/Tesseract-OCR/tesseract.exe"
}

locate() {
  local path
  path=$(configured_path)
  if [[ -n "$path" ]]; then
    # A configured path is the only one the app tries.
    [[ -f "$path" ]] && printf '%s' "$path"
    return
  fi
  if command -v tesseract >/dev/null 2>&1; then
    command -v tesseract
    return
  fi
  if [[ "${OS:-}" == "Windows_NT" && -f "$(windows_default)" ]]; then
    windows_default
  fi
}

# The package manager that installs Tesseract here: winget on Windows, Homebrew on macOS,
# and on Linux whichever of apt-get (Debian, Ubuntu), dnf or yum (Fedora, RHEL, Rocky,
# Alma, Amazon Linux), apk (Alpine), pacman (Arch) or zypper (openSUSE, SLES) is present.
manager() {
  if [[ "${OS:-}" == "Windows_NT" ]]; then
    command -v winget >/dev/null 2>&1 && echo winget
    return
  fi
  if [[ "$(uname -s)" == "Darwin" ]]; then
    command -v brew >/dev/null 2>&1 && echo brew
    return
  fi
  local candidate
  for candidate in apt-get dnf yum apk pacman zypper; do
    if command -v "$candidate" >/dev/null 2>&1; then
      echo "$candidate"
      return
    fi
  done
}

# The packages for Tesseract and each OCR_LANGUAGES language, as each manager names them.
# winget's and Homebrew's base packages already carry English.
packages() {
  local lang list=()
  case "$1" in
    winget) list=(UB-Mannheim.TesseractOCR) ;;
    brew)
      list=(tesseract)
      for lang in $(languages); do [[ "$lang" != eng ]] && list+=(tesseract-lang) && break; done
      ;;
    apt-get)
      list=(tesseract-ocr)
      for lang in $(languages); do list+=("tesseract-ocr-${lang//_/-}"); done
      ;;
    dnf | yum)
      list=(tesseract)
      for lang in $(languages); do list+=("tesseract-langpack-${lang}"); done
      ;;
    apk)
      list=(tesseract-ocr)
      for lang in $(languages); do list+=("tesseract-ocr-data-${lang}"); done
      ;;
    pacman)
      list=(tesseract)
      for lang in $(languages); do list+=("tesseract-data-${lang}"); done
      ;;
    zypper)
      list=(tesseract-ocr)
      for lang in $(languages); do [[ "$lang" == eng ]] && list+=(tesseract-ocr-traineddata-english); done
      ;;
  esac
  printf '%s\n' "${list[@]}"
}

# Runs a command as root: directly when already root, otherwise through sudo.
as_root() {
  if [[ "$(id -u)" -eq 0 ]]; then
    "$@"
  elif command -v sudo >/dev/null 2>&1; then
    sudo "$@"
  else
    echo "Installing Tesseract needs root, and sudo is not available. Run make install as root."
    return 1
  fi
}

install_command() {
  local pm=$1 list
  list=$(packages "$pm" | tr '\n' ' ')
  case "$pm" in
    winget) echo "winget install --id UB-Mannheim.TesseractOCR -e   (an administrator prompt appears)" ;;
    brew) echo "brew install ${list}" ;;
    apt-get) echo "sudo apt-get install -y ${list}" ;;
    dnf | yum) echo "sudo $pm install -y ${list}  (on RHEL, Rocky or Alma, enable EPEL first)" ;;
    apk) echo "apk add ${list}" ;;
    pacman) echo "sudo pacman -S --noconfirm ${list}" ;;
    zypper) echo "sudo zypper install -y ${list}" ;;
  esac
}

install_hint() {
  local pm
  pm=$(manager)
  if [[ -n "$pm" ]]; then
    echo "  $(install_command "$pm")"
    echo "  or run: make install"
  else
    echo "  see https://tesseract-ocr.github.io/tessdoc/Installation.html"
  fi
}

check() {
  local found version major missing=()
  found=$(locate)
  if [[ -z "$found" ]]; then
    local path
    path=$(configured_path)
    if [[ -n "$path" ]]; then
      echo "Tesseract OCR is not at OCR_TESSERACT_PATH ($path). Fix the path in .env, or install it:"
    else
      echo "Tesseract OCR $MIN_MAJOR is not installed. Screenshots and scans would wait for a person to read them. Install it:"
    fi
    install_hint
    return 1
  fi
  version=$("$found" --version 2>&1 | head -1 | tr -d '\r' | grep -oE '[0-9]+\.[0-9]+(\.[0-9]+)?' | head -1)
  major=${version%%.*}
  if [[ -z "$major" || "$major" -lt "$MIN_MAJOR" ]]; then
    echo "Tesseract OCR ${version:-of an unknown version} at $found is older than $MIN_MAJOR. Upgrade it:"
    install_hint
    return 1
  fi
  local installed
  installed=$("$found" --list-langs 2>/dev/null | tr -d '\r' | tail -n +2)
  for lang in $(languages); do
    grep -qx "$lang" <<<"$installed" || missing+=("$lang")
  done
  if ((${#missing[@]} > 0)); then
    echo "Tesseract OCR $version at $found lacks the OCR_LANGUAGES language data: ${missing[*]}. Add it:"
    install_hint
    echo "  or copy each <lang>.traineddata into its tessdata folder"
    return 1
  fi
  echo "Tesseract OCR $version at $found ($(languages | tr ' ' '+'))"
}

# Installs what is missing: Tesseract itself, or a language it lacks. Already complete,
# it changes nothing.
install() {
  if check >/dev/null 2>&1; then
    check
    return
  fi
  local pm list=()
  pm=$(manager)
  if [[ -z "$pm" ]]; then
    echo "No supported package manager (winget, brew, apt-get, dnf, yum, apk, pacman, zypper)."
    echo "Install Tesseract OCR $MIN_MAJOR by hand: https://tesseract-ocr.github.io/tessdoc/Installation.html"
    return 1
  fi
  # Package names have no spaces; macOS's bash 3.2 has no mapfile.
  # shellcheck disable=SC2207
  list=($(packages "$pm"))
  echo "Installing Tesseract OCR, the local engine that reads screenshots and scans, with $pm: ${list[*]}"
  case "$pm" in
    winget)
      if [[ -z "$(locate)" ]]; then
        winget install --id UB-Mannheim.TesseractOCR -e --silent \
          --accept-source-agreements --accept-package-agreements || return 1
      fi
      ;;
    brew) brew install "${list[@]}" || return 1 ;;
    apt-get)
      # From the package lists the system already has, when they name packages the mirror
      # still serves (a CI runner's image refreshes its lists every week); `apt-get update`
      # only when they do not. With the lists refreshed every time, the CI step took from 7
      # to 172 seconds (19 November 2026). Recommended packages are not needed to read text.
      if ! as_root env DEBIAN_FRONTEND=noninteractive \
        apt-get install -y -qq --no-install-recommends "${list[@]}"; then
        echo "The package lists are missing or out of date: refreshing them (apt-get update)."
        as_root env DEBIAN_FRONTEND=noninteractive apt-get update -qq &&
          as_root env DEBIAN_FRONTEND=noninteractive \
            apt-get install -y -qq --no-install-recommends "${list[@]}" || return 1
      fi
      ;;
    dnf | yum)
      if ! as_root "$pm" install -y -q "${list[@]}"; then
        # RHEL, Rocky, Alma and CentOS Stream ship Tesseract in EPEL, not their own repos.
        if as_root "$pm" list -q epel-release >/dev/null 2>&1; then
          echo "Tesseract is not in this system's own repositories; enabling EPEL (Extra Packages for Enterprise Linux)."
          as_root "$pm" install -y -q epel-release && as_root "$pm" install -y -q "${list[@]}"
        fi
      fi
      if ! check >/dev/null 2>&1; then
        # Tested 17 November 2026: Amazon Linux 2023 has no Tesseract package, and EPEL 9
        # (RHEL, Rocky, Alma 9) carries 4.1.1.
        echo "This system's package repositories have no Tesseract OCR $MIN_MAJOR (Amazon Linux 2023 has none; EPEL 9 carries 4.1)."
        echo "  Run the API on Ubuntu, Debian, Fedora, Alpine, Arch or openSUSE (or a container of one),"
        echo "  or build Tesseract $MIN_MAJOR from source:"
        echo "  https://tesseract-ocr.github.io/tessdoc/Compiling.html"
        return 1
      fi
      ;;
    apk) as_root apk add --no-cache -q "${list[@]}" || return 1 ;;
    pacman) as_root pacman -Sy --noconfirm --needed "${list[@]}" || return 1 ;;
    zypper) as_root zypper --non-interactive install "${list[@]}" || return 1 ;;
  esac
  check
}

case "$mode" in
  check) check ;;
  install) install ;;
  *)
    echo "Usage: scripts/tesseract.sh check|install"
    exit 2
    ;;
esac
