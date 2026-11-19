"""Which code and which database each local server runs: one line per listening port.

    python scripts/env_status.py [--ports 8000,3000,8030-8050]      (make env-status)

For every port of the set that something listens on: the port, its role (api or web), the
checkout the process serves, that checkout's branch, short commit, number of uncommitted
files and how many commits it is behind origin/main (as of the last fetch; nothing is
fetched), and for an API the NAME of the database it uses. For an API that has
/health/version, the commit its code was loaded from and the latest migration applied to its
database too; a commit other than the checkout's means the server runs older code than the
checkout holds (a reload that did not happen).

Where each fact comes from:
- the listening process: `netstat -ano` on Windows, /proc/net/tcp on Linux;
- the checkout: an API's PYTHONPATH (a scratch stack sets it) or else its working
  directory; a web server's node_modules path on its command line or else its working
  directory; then `git rev-parse --show-toplevel` there;
- the database: the process's own DATABASE_URL when its environment is readable (a
  process of the same user: the process block on Windows, /proc/<pid>/environ on Linux),
  else the record a scratch API wrote from its own environment (tmp/scratch-stack/), else
  "unknown".

Read only: no process is stopped, nothing is fetched, no database is opened. Only names are
printed: never a URL, a password, a token or any other environment value. Standard library
only, so it runs with any Python 3.14.
"""

from __future__ import annotations

import argparse
import json
import re
import struct
import subprocess
import sys
import urllib.error
import urllib.request
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path, PurePath, PureWindowsPath
from typing import Any
from urllib.parse import urlsplit

# The development stack (make go), then the scratch stacks' pairs (scripts/scratch_stack.py).
DEFAULT_PORTS: tuple[int, ...] = (
    8000, 3000, 8010, 3010, 8020, 3020,
    *(port for n in range(30, 51) for port in (8000 + n, 3000 + n)),
)  # fmt: skip
DATABASE_NAME = re.compile(r"[A-Za-z_][A-Za-z0-9_$-]{0,62}")
COMMIT = re.compile(r"[0-9a-f]{7,40}")
MIGRATION = re.compile(r"\d{4}_[a-z0-9_]+")
TEXT: dict[str, Any] = {"text": True, "encoding": "utf-8", "errors": "replace"}


@dataclass(frozen=True)
class Process:
    pid: int
    image: str  # the executable's file name, lower case ("" when unknown)
    command: str  # the command line ("" when unreadable)
    cwd: str | None
    environ: Mapping[str, str] | None  # None when another user's, or unreadable


@dataclass(frozen=True)
class Checkout:
    path: Path
    branch: str
    commit: str
    uncommitted: int
    behind: int | None  # None when there is no origin/main


@dataclass(frozen=True)
class Row:
    port: int
    role: str
    checkout: Checkout | None
    database: str
    running: str


# --- the arguments ----------------------------------------------------------------------


def parse_ports(text: str) -> list[int]:
    """`8000,3000,8030-8050` as ports, in the order given, each once."""
    ports: list[int] = []
    for part in (piece.strip() for piece in re.split(r"[,\s]+", text)):
        if not part:
            continue
        low, dash, high = part.partition("-")
        if not low.isdigit() or (dash and not high.isdigit()):
            raise ValueError(f"not a port or a range of ports: {part!r}")
        first, last = int(low), int(high or low)
        if not 0 < first <= last < 65536:
            raise ValueError(f"not a port or a range of ports: {part!r}")
        ports.extend(port for port in range(first, last + 1) if port not in ports)
    return ports


# --- who listens ------------------------------------------------------------------------


def parse_netstat(text: str) -> dict[int, int]:
    """Port to process id of every listening TCP socket in `netstat -ano` output."""
    found: dict[int, int] = {}
    for line in text.splitlines():
        fields = line.split()
        if len(fields) == 5 and fields[0].upper() == "TCP" and fields[3] == "LISTENING":
            port = fields[1].rsplit(":", 1)[-1]
            if port.isdigit() and fields[4].isdigit():
                found.setdefault(int(port), int(fields[4]))
    return found


def parse_proc_net_tcp(text: str) -> dict[int, int]:
    """Port to socket inode of every listening socket in /proc/net/tcp or tcp6."""
    found: dict[int, int] = {}
    for line in text.splitlines()[1:]:
        fields = line.split()
        if len(fields) > 9 and fields[3] == "0A":  # TCP_LISTEN
            found.setdefault(int(fields[1].rsplit(":", 1)[1], 16), int(fields[9]))
    return found


def listening() -> dict[int, int]:
    """Port to the process id that listens on it."""
    if sys.platform == "win32":
        result = subprocess.run(["netstat", "-ano"], capture_output=True, check=False, **TEXT)
        return parse_netstat(result.stdout)
    inodes: dict[int, int] = {}
    for name in ("tcp", "tcp6"):
        try:
            text = Path(f"/proc/net/{name}").read_text()
        except OSError:
            continue
        for port, inode in parse_proc_net_tcp(text).items():
            inodes.setdefault(port, inode)
    owners: dict[int, int] = {}
    for fd in Path("/proc").glob("[0-9]*/fd/*"):
        try:
            link = fd.readlink().as_posix()
        except OSError:
            continue
        if link.startswith("socket:["):
            owners.setdefault(int(link[8:-1]), int(fd.parts[2]))
    return {port: owners[inode] for port, inode in inodes.items() if inode in owners}


# --- the process ------------------------------------------------------------------------


def parse_environment_block(block: str) -> dict[str, str]:
    """A process's environment block (`KEY=VALUE` entries split by NUL) as a mapping. On
    Windows the names are matched without case, so they are kept upper case there."""
    found: dict[str, str] = {}
    for entry in block.split("\0"):
        key, sep, value = entry.partition("=")
        if sep and key:  # `=C:=C:\\...` entries have no name
            found[key.upper() if sys.platform == "win32" else key] = value
    return found


def _windows_process(pid: int) -> Process:
    import ctypes
    from ctypes import wintypes

    kernel = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
    kernel.OpenProcess.restype = wintypes.HANDLE
    kernel.CloseHandle.argtypes = [wintypes.HANDLE]
    kernel.QueryFullProcessImageNameW.argtypes = [
        wintypes.HANDLE, wintypes.DWORD, wintypes.LPWSTR, ctypes.POINTER(wintypes.DWORD),
    ]  # fmt: skip
    kernel.IsWow64Process.argtypes = [wintypes.HANDLE, ctypes.POINTER(wintypes.BOOL)]
    kernel.ReadProcessMemory.argtypes = [
        wintypes.HANDLE, ctypes.c_void_p, ctypes.c_void_p, ctypes.c_size_t,
        ctypes.POINTER(ctypes.c_size_t),
    ]  # fmt: skip
    ntdll = ctypes.WinDLL("ntdll")
    ntdll.NtQueryInformationProcess.argtypes = [
        wintypes.HANDLE, ctypes.c_int, ctypes.c_void_p, wintypes.ULONG, ctypes.c_void_p,
    ]  # fmt: skip
    ntdll.NtQueryInformationProcess.restype = ctypes.c_long
    handle = kernel.OpenProcess(0x0400 | 0x0010, False, pid)  # QUERY_INFORMATION | VM_READ
    readable = bool(handle)
    if not readable:
        handle = kernel.OpenProcess(0x1000, False, pid)  # QUERY_LIMITED_INFORMATION
    if not handle:
        return Process(pid, "", "", None, None)
    try:
        size = wintypes.DWORD(1024)
        buffer = ctypes.create_unicode_buffer(size.value)
        image = ""
        if kernel.QueryFullProcessImageNameW(handle, 0, buffer, ctypes.byref(size)):
            image = PureWindowsPath(buffer.value).name.lower()
        wow64 = wintypes.BOOL(False)
        kernel.IsWow64Process(handle, ctypes.byref(wow64))
        if not readable or wow64.value or struct.calcsize("P") != 8:
            return Process(pid, image, "", None, None)

        def read(address: int, length: int) -> bytes | None:
            data = ctypes.create_string_buffer(length)
            done = ctypes.c_size_t(0)
            if not kernel.ReadProcessMemory(handle, address, data, length, ctypes.byref(done)):
                return None
            return data.raw[: done.value]

        info = (ctypes.c_void_p * 6)()  # PROCESS_BASIC_INFORMATION
        if ntdll.NtQueryInformationProcess(handle, 0, info, ctypes.sizeof(info), None) != 0:
            return Process(pid, image, "", None, None)
        peb = read(info[1] or 0, 0x28)
        params_at = struct.unpack_from("<Q", peb, 0x20)[0] if peb and len(peb) == 0x28 else 0
        params = read(params_at, 0x3F8) if params_at else None
        if params is None or len(params) < 0x3F8:
            return Process(pid, image, "", None, None)

        def unicode_string(offset: int) -> str | None:
            length = struct.unpack_from("<H", params, offset)[0]
            address = struct.unpack_from("<Q", params, offset + 8)[0]
            text = read(address, length) if address and length else None
            return None if text is None else text.decode("utf-16-le", "replace")

        # RTL_USER_PROCESS_PARAMETERS on 64-bit Windows: CurrentDirectory.DosPath at 0x38,
        # CommandLine at 0x70, Environment at 0x80, EnvironmentSize at 0x3F0.
        cwd = unicode_string(0x38)
        command = unicode_string(0x70) or ""
        env_at = struct.unpack_from("<Q", params, 0x80)[0]
        env_size = struct.unpack_from("<Q", params, 0x3F0)[0]
        block = read(env_at, min(env_size, 1 << 20)) if env_at and env_size else None
        environ = None
        if block is not None:
            environ = parse_environment_block(block.decode("utf-16-le", "replace"))
        return Process(pid, image, command, cwd, environ)
    finally:
        kernel.CloseHandle(handle)


def _linux_process(pid: int) -> Process:
    base = Path(f"/proc/{pid}")

    def read(name: str) -> bytes | None:
        try:
            return (base / name).read_bytes()
        except OSError:
            return None

    command = (read("cmdline") or b"").replace(b"\0", b" ").decode("utf-8", "replace").strip()
    try:
        image = Path(base / "exe").readlink().name.lower()
    except OSError:
        image = (read("comm") or b"").decode("utf-8", "replace").strip().lower()
    try:
        cwd: str | None = str((base / "cwd").readlink())
    except OSError:
        cwd = None
    block = read("environ")
    environ = None if block is None else parse_environment_block(block.decode("utf-8", "replace"))
    return Process(pid, image, command, cwd, environ)


def process(pid: int) -> Process:
    return _windows_process(pid) if sys.platform == "win32" else _linux_process(pid)


# --- what it serves ---------------------------------------------------------------------


def role_of(image: str, command: str) -> str:
    """api for the API (uvicorn serving ai_workforce_api, or a scratch stack's API), web for
    the Next.js server, else the program's name."""
    name = image.removesuffix(".exe")
    if name.startswith("python") and (
        "ai_workforce_api" in command or "scratch_stack.py" in command
    ):
        return "api"
    if name == "node" and "next" in command:
        return "web"
    return name or "unknown"


def _path(text: str) -> PurePath:
    return PureWindowsPath(text) if re.match(r"^[A-Za-z]:[\\/]", text) else PurePath(text)


def served_directory(role: str, process: Process) -> str | None:
    """The directory whose checkout the process serves (not yet its top level)."""
    if role == "api" and process.environ is not None:
        separator = ";" if sys.platform == "win32" else ":"
        for entry in process.environ.get("PYTHONPATH", "").split(separator):
            parts = _path(entry.strip()).parts
            if len(parts) > 2 and [p.lower() for p in parts[-2:]] == ["services", "api"]:
                return str(_path(entry.strip()).parent.parent)
    if role == "web":
        found = re.search(
            r"([A-Za-z]:[\\/][^\"]*?|/[^\"\s]*?)[\\/]node_modules[\\/]", process.command
        )
        if found is not None:
            return found.group(1)
    return process.cwd


def _git(path: Path, *args: str) -> str | None:
    try:
        result = subprocess.run(
            ["git", "-C", str(path), *args], capture_output=True, check=False, timeout=20, **TEXT
        )
    except OSError, subprocess.TimeoutExpired:
        return None
    return result.stdout.strip() if result.returncode == 0 else None


def checkout_state(directory: str | Path) -> Checkout | None:
    """The git checkout that holds the directory: its branch, commit, uncommitted files and
    distance behind origin/main. None when the directory is in no checkout."""
    top = _git(Path(directory), "rev-parse", "--show-toplevel")
    if not top:
        return None
    path = Path(top)
    branch = _git(path, "rev-parse", "--abbrev-ref", "HEAD") or "?"
    commit = _git(path, "rev-parse", "--short", "HEAD") or "?"
    status = _git(path, "status", "--porcelain") or ""
    behind = _git(path, "rev-list", "--count", "HEAD..origin/main")
    return Checkout(
        path,
        "detached" if branch == "HEAD" else branch,
        commit,
        len([line for line in status.splitlines() if line.strip()]),
        int(behind) if behind and behind.isdigit() else None,
    )


def database_name(url: str) -> str | None:
    """The database a PostgreSQL URL names: its name only, never the rest of the URL."""
    try:
        name = urlsplit(url).path.lstrip("/")
    except ValueError:
        return None
    return name if DATABASE_NAME.fullmatch(name) else None


def scratch_record(checkout: Path, port: int, pid: int) -> Mapping[str, object] | None:
    """The record a scratch API wrote for this port from its own environment, if it is this
    process's (scripts/scratch_stack.py serve_api)."""
    try:
        record = json.loads((checkout / "tmp" / "scratch-stack" / f"api-{port}.json").read_text())
    except OSError, ValueError:
        return None
    return record if isinstance(record, dict) and record.get("pid") == pid else None


def database_of(process: Process, checkout: Checkout | None, port: int) -> str:
    if process.environ is not None and process.environ.get("DATABASE_URL"):
        return database_name(process.environ["DATABASE_URL"]) or "unknown"
    if checkout is not None:
        record = scratch_record(checkout.path, port, process.pid)
        name = record.get("db") if record is not None else None
        if isinstance(name, str) and DATABASE_NAME.fullmatch(name):
            return f"{name} (scratch record)"
    return "unknown"


def read_version(body: object) -> str:
    """`<commit> mig <head>` from a /health/version body; only values of the expected
    shape are shown."""
    if not isinstance(body, dict):
        return "-"
    commit, head = body.get("commit"), body.get("migrations_head")
    shown = commit if isinstance(commit, str) and COMMIT.fullmatch(commit) else "?"
    if isinstance(head, str) and MIGRATION.fullmatch(head):
        return f"{shown[:7]} mig {head[:4]}"
    return f"{shown[:7]} mig ?"


def running_version(port: int) -> str:
    """What an API reports at /health/version ("-" when it has no such route)."""
    try:
        with urllib.request.urlopen(f"http://127.0.0.1:{port}/health/version", timeout=2) as r:
            return read_version(json.loads(r.read(4096)))
    except urllib.error.URLError, OSError, ValueError:
        return "-"


# --- the report -------------------------------------------------------------------------


def stale(row: Row) -> bool:
    """An API whose loaded code is another commit than its checkout's."""
    loaded = row.running.split(" ", 1)[0]
    return (
        row.checkout is not None
        and COMMIT.fullmatch(loaded) is not None
        and not row.checkout.commit.startswith(loaded)
        and not loaded.startswith(row.checkout.commit)
    )


def format_rows(rows: Sequence[Row]) -> list[str]:
    header = ("PORT", "ROLE", "BRANCH", "COMMIT", "UNCOMMITTED", "BEHIND", "DATABASE", "RUNNING")
    table = [header]
    for row in rows:
        checkout = row.checkout
        behind = "?" if checkout is None or checkout.behind is None else str(checkout.behind)
        running = row.running + (" (older code)" if stale(row) else "")
        table.append(
            (
                str(row.port),
                row.role,
                checkout.branch if checkout else "?",
                checkout.commit if checkout else "?",
                str(checkout.uncommitted) if checkout else "?",
                behind,
                row.database,
                running,
            )
        )
    # The checkout's path last: it is the longest and the one column left unpadded.
    paths = ["CHECKOUT", *(str(row.checkout.path) if row.checkout else "?" for row in rows)]
    widths = [max(len(line[column]) for line in table) for column in range(len(header))]
    return [
        "  ".join(cell.ljust(width) for cell, width in zip(line, widths, strict=True)) + "  " + path
        for line, path in zip(table, paths, strict=True)
    ]


def status(ports: Sequence[int]) -> list[str]:
    if sys.platform not in ("win32", "linux"):
        return [f"env_status: not supported on {sys.platform} (Windows and Linux only)."]
    owners = listening()
    rows = []
    for port in ports:
        pid = owners.get(port)
        if pid is None:
            continue
        found = process(pid)
        role = role_of(found.image, found.command)
        directory = served_directory(role, found)
        checkout = checkout_state(directory) if directory else None
        database = database_of(found, checkout, port) if role == "api" else "-"
        running = running_version(port) if role == "api" else "-"
        rows.append(Row(port, role, checkout, database, running))
    if not rows:
        return [f"Nothing listens on {', '.join(str(port) for port in ports)}."]
    return format_rows(rows)


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n", 1)[0])
    parser.add_argument(
        "--ports",
        default="",
        help="ports or ranges, e.g. 8000,3000,8030-8050 (default: the development and "
        "scratch ports)",
    )
    args = parser.parse_args(argv)
    try:
        ports = parse_ports(args.ports) if args.ports else list(DEFAULT_PORTS)
    except ValueError as error:
        print(f"env_status: {error}")
        return 2
    print("\n".join(status(ports)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
