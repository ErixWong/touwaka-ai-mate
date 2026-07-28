# wikijs status

Status: frozen draft.

Decision: do not implement or register this skill in the current optimization round.

Reason:

- It can mutate an external Wiki.js instance through GraphQL and upload endpoints.
- The directory contains client/reference scripts, but no `index.js` / `index.py` skill entrypoint.
- The runtime contract is unclear: it needs explicit credential source, dry-run/write behavior, and user-facing audit/error handling before exposure.

Activation requirements:

1. Define whether this is a read-only, write-capable, or migration-only skill.
2. Add a real skill entrypoint with explicit tool schemas.
3. Use project-standard configuration/secrets handling instead of implicit ambient credentials.
4. Add dry-run support for write operations where practical.
5. Add focused tests for request construction, credential absence, and non-2xx/error responses.
