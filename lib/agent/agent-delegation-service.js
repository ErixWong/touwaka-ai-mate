/**
 * Agent delegation service contract.
 *
 * This service prepares a child Agent run envelope. Child execution is explicit
 * via delegateAndExecute() and requires a caller-provided executor adapter.
 */

import {
  buildAgentEvent,
} from './agent-event.js';
import {
  deriveChildAgentInvocationContext,
} from './agent-invocation-context.js';
import {
  buildDeclaredCapabilityScope,
  intersectCapabilityScopes,
  assertRequestedCapabilitiesAllowed,
} from './capability-scope-builder.js';
import { sealAgentDelegation } from './agent-delegation-integrity.js';

export class AgentDelegationService {
  constructor({
    definition_resolver,
    event_sink = null,
    max_delegation_depth = 2,
  } = {}) {
    if (!definition_resolver || typeof definition_resolver.resolve !== 'function') {
      throw new Error('definition_resolver is required');
    }

    this.definition_resolver = definition_resolver;
    this.event_sink = event_sink;
    this.max_delegation_depth = max_delegation_depth;
  }

  async delegate({
    parent_invocation,
    target,
    task,
    input = {},
    expected_output = null,
    requested_scope = null,
    caller_scope = {},
    principal_scope = {},
    workspace_scope = {},
    invocation_mode = 'llm',
    source = 'agent_delegate',
  } = {}) {
    if (!parent_invocation) {
      throw new Error('parent_invocation is required');
    }
    if (!target?.source_type || !target?.agent_id) {
      throw new Error('target.source_type and target.agent_id are required');
    }
    if (!task || typeof task !== 'string') {
      throw new Error('task is required');
    }

    const callee_definition = await this.definition_resolver.resolve({
      source_type: target.source_type,
      agent_id: target.agent_id,
    });
    if (!callee_definition) {
      throw new Error(`Agent target not found: ${target.source_type}/${target.agent_id}`);
    }
    if (callee_definition.is_active === false) {
      throw new Error(`Agent target inactive: ${target.source_type}/${target.agent_id}`);
    }

    const callee_scope = buildDeclaredCapabilityScope(callee_definition);
    const effective_scope = intersectCapabilityScopes({
      caller_scope,
      callee_scope,
      principal_scope,
      workspace_scope,
      requested_scope,
    });
    if (requested_scope) {
      assertRequestedCapabilitiesAllowed(effective_scope, requested_scope);
    }

    const child_invocation = deriveChildAgentInvocationContext(parent_invocation, {
      callee_agent_id: callee_definition.agent_id,
      workspace_scope,
      capability_scope: effective_scope,
      invocation_mode,
      source,
      max_delegation_depth: this.max_delegation_depth,
    });

    const delegation = sealAgentDelegation({
      status: 'accepted',
      parent_invocation,
      child_invocation,
      callee_definition,
      task,
      input,
      expected_output,
      requested_scope,
      effective_scope,
    });

    await this.emit('delegation_created', child_invocation, {
      task,
      source_type: callee_definition.source_type,
      agent_id: callee_definition.agent_id,
    });

    return delegation;
  }

  async delegateAndExecute(input = {}, child_executor) {
    if (!child_executor || typeof child_executor.execute !== 'function') {
      throw new Error('child_executor.execute is required');
    }

    const delegation = await this.delegate(input);
    const execution_result = await child_executor.execute(delegation);

    return Object.freeze({
      ...delegation,
      execution_result,
    });
  }

  async emit(type, invocation_context, payload = {}) {
    const event = buildAgentEvent({
      type,
      invocation_context,
      payload,
    });

    if (typeof this.event_sink === 'function') {
      await this.event_sink(event);
    } else if (this.event_sink && typeof this.event_sink.emit === 'function') {
      await this.event_sink.emit(event);
    }

    return event;
  }
}

export default AgentDelegationService;
