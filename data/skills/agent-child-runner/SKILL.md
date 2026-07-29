---
name: agent-child-runner
description: "Internal resident worker for delegated child Agent runs."
is_resident: 1
user-invocable: false
allowed-tools: []
---

# Agent Child Runner

Internal resident worker for asynchronous child Agent execution.

This skill is not intended to be exposed directly to the LLM. Root Agent control
tools call it through `ResidentSkillManager.invokeByName()` using the
`agent-child-runner` / `invoke` entrypoint.

## Protocol

Input is a JSON object with an `action` field:

- `start`: accepts an accepted delegation envelope and returns a child run handle immediately.
- `status`: returns the current child run status.
- `result`: returns completed result and buffered events.
- `events`: returns buffered child run events.
- `cancel`: requests cancellation.

The worker owns run state. Actual child Agent execution is delegated back to the
main service through `/internal/agent/child-run/execute`, preserving the main
process AgentLoop, ToolManager, and database service boundaries.
