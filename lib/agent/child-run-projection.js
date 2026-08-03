/**
 * Child Agent run projection.
 *
 * Converts an accepted delegation envelope into LLM protocol messages for the
 * child agent. Authorization identity stays in metadata, not in the prompt.
 */

function assertDelegation(delegation) {
  if (!delegation || typeof delegation !== 'object') {
    throw new Error('delegation is required');
  }
  if (!delegation.child_invocation) {
    throw new Error('delegation.child_invocation is required');
  }
  if (!delegation.callee_definition) {
    throw new Error('delegation.callee_definition is required');
  }
  if (!delegation.task || typeof delegation.task !== 'string') {
    throw new Error('delegation.task is required');
  }
}

function normalizeObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value
    : {};
}

function buildSystemContent(calleeDefinition) {
  const displayName = calleeDefinition.display_name || calleeDefinition.agent_id || 'Child Agent';
  const prompt = calleeDefinition.system_prompt || calleeDefinition.description || '';

  return [
    `You are ${displayName}.`,
    prompt ? `Agent instructions:\n${prompt}` : null,
    'You are running as a child agent. The next user message is a delegation package from the caller agent, not a direct human identity.',
    'Work only within the provided task, expected output, and capability scope.',
  ].filter(Boolean).join('\n\n');
}

function buildTaskPackage(delegation) {
  const childInvocation = delegation.child_invocation;
  const workspaceScope = normalizeObject(childInvocation.workspace_scope);

  return {
    type: 'agent_delegation_task',
    task: delegation.task,
    input: delegation.input ?? {},
    expected_output: delegation.expected_output ?? null,
    caller_agent_id: childInvocation.caller_agent_id,
    callee_agent_id: childInvocation.callee_agent_id,
    parent_run_id: childInvocation.parent_run_id,
    run_id: childInvocation.run_id,
    capability_scope: normalizeObject(delegation.effective_scope || childInvocation.capability_scope),
    workspace: workspaceScope.workdir
      ? {
          workspace_mode: workspaceScope.workspace_mode || null,
          current_workdir: workspaceScope.logical_workdir || workspaceScope.logical_workspace_path || workspaceScope.workdir,
          current_path: workspaceScope.current_path || '',
          relative_paths_are_resolved_from_current_workdir: true,
        }
      : null,
  };
}

function freezeProjection(projection) {
  return Object.freeze({
    ...projection,
    messages: Object.freeze(projection.messages.map(message => Object.freeze({ ...message }))),
    metadata: Object.freeze({ ...projection.metadata }),
  });
}

export function buildChildAgentRunProjection(delegation) {
  assertDelegation(delegation);

  const childInvocation = delegation.child_invocation;
  const calleeDefinition = delegation.callee_definition;
  const taskPackage = buildTaskPackage(delegation);

  return freezeProjection({
    invocation_context: childInvocation,
    messages: [
      {
        role: 'system',
        content: buildSystemContent(calleeDefinition),
      },
      {
        role: 'user',
        content: JSON.stringify(taskPackage, null, 2),
      },
    ],
    metadata: {
      principal_user_id: childInvocation.principal_user_id,
      caller_agent_id: childInvocation.caller_agent_id,
      callee_agent_id: childInvocation.callee_agent_id,
      parent_run_id: childInvocation.parent_run_id,
      run_id: childInvocation.run_id,
      delegation_depth: childInvocation.delegation_depth,
      source_type: calleeDefinition.source_type || null,
      effective_scope: normalizeObject(delegation.effective_scope || childInvocation.capability_scope),
    },
  });
}

export default {
  buildChildAgentRunProjection,
};
