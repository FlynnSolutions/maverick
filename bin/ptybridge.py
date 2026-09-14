#!/usr/bin/env python3
"""Run a command inside a pseudo-terminal, bridging it to stdin/stdout.

Node has no pty without a native dependency; the Python standard library does. The
console server spawns this with the command to run, writes keystrokes to its stdin, and
reads the terminal byte stream from its stdout.

Resize is carried in-band: the server writes an OSC sequence `ESC ] 9999 ; cols ; rows BEL`
into stdin and this script applies it with TIOCSWINSZ instead of forwarding it.
"""
from __future__ import annotations

import fcntl
import os
import pty
import select
import signal
import struct
import sys
import termios

RESIZE_PREFIX = b"\x1b]9999;"
RESIZE_END = b"\x07"


def set_winsize(fd: int, cols: int, rows: int) -> None:
    fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", rows, cols, 0, 0))


def main(argv: list[str]) -> int:
    if len(argv) < 4:
        sys.stderr.write("usage: pty.py <cols> <rows> <command> [args...]\n")
        return 2
    cols, rows = int(argv[1]), int(argv[2])
    command = argv[3:]

    pid, master_fd = pty.fork()
    if pid == 0:
        os.execvp(command[0], command)

    set_winsize(master_fd, cols, rows)
    stdin_fd = sys.stdin.fileno()
    stdout_fd = sys.stdout.fileno()
    pending = b""

    def forward_input(data: bytes) -> None:
        nonlocal pending
        pending += data
        while True:
            start = pending.find(RESIZE_PREFIX)
            if start < 0:
                os.write(master_fd, pending)
                pending = b""
                return
            if start > 0:
                os.write(master_fd, pending[:start])
                pending = pending[start:]
            end = pending.find(RESIZE_END)
            if end < 0:
                return  # incomplete resize sequence; wait for the rest
            body = pending[len(RESIZE_PREFIX):end].decode("ascii", "replace")
            pending = pending[end + 1:]
            try:
                new_cols, new_rows = (int(part) for part in body.split(";"))
                set_winsize(master_fd, new_cols, new_rows)
                os.kill(pid, signal.SIGWINCH)
            except (ValueError, OSError) as err:
                sys.stderr.write(f"pty.py: bad resize {body!r}: {err}\n")

    try:
        while True:
            ready, _, _ = select.select([master_fd, stdin_fd], [], [])
            if master_fd in ready:
                try:
                    chunk = os.read(master_fd, 65536)
                except OSError:
                    break  # child closed the terminal
                if not chunk:
                    break
                os.write(stdout_fd, chunk)
            if stdin_fd in ready:
                chunk = os.read(stdin_fd, 65536)
                if not chunk:
                    os.close(master_fd)
                    break
                forward_input(chunk)
    finally:
        _, status = os.waitpid(pid, 0)
    return os.waitstatus_to_exitcode(status)


if __name__ == "__main__":
    sys.exit(main(sys.argv))
