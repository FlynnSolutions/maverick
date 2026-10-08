# Security

Maverick is a local, single-user process. It binds to `127.0.0.1` unless you open it to your
LAN with `SESSION_CONSOLE_HOST=0.0.0.0`, in which case every non-loopback client has to present
the access key once. It runs `claude`, `git` and `gh` on your behalf, reads Claude Code's own
session files, and commits one-line moves into your trackers. Treat it as you would treat a
terminal with those tools in it.

## Reporting a vulnerability

Please do not open a public issue for a security problem. Email
**cory@flynnsolutions.com** with what you found and how to reproduce it. You will get a reply,
and a fix or a reason within a reasonable time; there is no bounty, and credit in the release
notes is yours if you want it.

## Supported versions

Only the latest release on GitHub and the `main` branch.
