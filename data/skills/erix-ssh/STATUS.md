# erix-ssh status

Status: frozen draft.

Decision: do not implement or register this skill in the current optimization round.

Reason:

- It controls remote hosts and has a materially higher permission boundary than normal file-processing skills.
- The directory contains resident-process building blocks, but no `index.js` / `index.py` skill entrypoint.
- The historical seed data references `scripts/ssh_client.js`, which does not exist in this directory.
- Exposing it before the resident-process lifecycle, credential handling, session auditing, and user confirmation model are finalized would create a misleading and risky tool surface.

Activation requirements:

1. Define the resident protocol and lifecycle ownership in code and tests.
2. Add a real skill entrypoint or explicit resident registration flow.
3. Add permission checks and user-visible audit events for connection, command execution, sudo, and file transfer.
4. Update `scripts/skills-data.json` only after the implementation is verified end-to-end.
5. Add focused tests for session isolation and secret redaction.
