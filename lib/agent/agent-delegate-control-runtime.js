/**
 * Agent delegate control runtime.
 *
 * Internal composition root for asynchronous child Agent control. This module
 * does not register tools; callers must explicitly decide where to expose it.
 */

import { AgentDelegationService } from './agent-delegation-service.js';
import { AgentDelegateControlFacade } from './agent-delegate-control-facade.js';
import { InMemoryChildRunScheduler } from './child-run-scheduler.js';
import { createExpertChildDelegationExecutor } from './child-delegation-runtime-factory.js';
import { ResidentChildRunScheduler } from './resident-child-run-scheduler.js';

function assertFunction(value, name) {
  if (typeof value !== 'function') {
    throw new Error(`${name} is required`);
  }
}

function assertObject(value, name) {
  if (!value || typeof value !== 'object') {
    throw new Error(`${name} is required`);
  }
}

export function createInMemoryAgentDelegateControlRuntime({
  definition_resolver,
  agent_runtime,
  agent_loop,
  get_expert_service,
  get_scoped_tools,
  projection_builder,
  event_sink = null,
  max_delegation_depth = 2,
} = {}) {
  assertObject(definition_resolver, 'definition_resolver');
  assertObject(agent_runtime, 'agent_runtime');
  assertObject(agent_loop, 'agent_loop');
  assertFunction(get_expert_service, 'get_expert_service');

  const delegation_service = new AgentDelegationService({
    definition_resolver,
    event_sink,
    max_delegation_depth,
  });
  const child_run_scheduler = new InMemoryChildRunScheduler({
    create_child_executor: run_options => createExpertChildDelegationExecutor({
      agent_runtime,
      agent_loop,
      get_expert_service,
      get_scoped_tools,
      projection_builder,
      run_options,
    }),
  });
  const control_facade = new AgentDelegateControlFacade({
    delegation_service,
    child_run_scheduler,
  });

  return Object.freeze({
    delegation_service,
    child_run_scheduler,
    control_facade,
  });
}

export function createResidentAgentDelegateControlRuntime({
  definition_resolver,
  resident_skill_manager,
  event_sink = null,
  max_delegation_depth = 2,
  skill_id,
  tool_name,
  timeout_ms,
  poll_interval_ms,
  wait_timeout_ms,
} = {}) {
  assertObject(definition_resolver, 'definition_resolver');

  const delegation_service = new AgentDelegationService({
    definition_resolver,
    event_sink,
    max_delegation_depth,
  });
  const child_run_scheduler = new ResidentChildRunScheduler({
    resident_skill_manager,
    skill_id,
    tool_name,
    timeout_ms,
    poll_interval_ms,
    wait_timeout_ms,
  });
  const control_facade = new AgentDelegateControlFacade({
    delegation_service,
    child_run_scheduler,
  });

  return Object.freeze({
    delegation_service,
    child_run_scheduler,
    control_facade,
  });
}

export default {
  createInMemoryAgentDelegateControlRuntime,
  createResidentAgentDelegateControlRuntime,
};
