/**
 * Child delegation runtime factory.
 *
 * Composes the internal child execution adapters without exposing an LLM tool
 * or changing root chat wiring.
 */

import { ChildAgentExecutor } from './child-agent-executor.js';
import { ExpertChildAgentRunner } from './expert-child-agent-runner.js';
import { getExpertChildScopedTools } from './expert-child-scoped-tools.js';

export function createExpertChildDelegationExecutor({
  agent_runtime,
  agent_loop,
  get_expert_service,
  get_scoped_tools = getExpertChildScopedTools,
  projection_builder,
  run_options = {},
} = {}) {
  const childRunner = new ExpertChildAgentRunner({
    agent_loop,
    get_expert_service,
    get_scoped_tools,
  });

  return new ChildAgentExecutor({
    agent_runtime,
    projection_builder,
    run_child: input => childRunner.run({
      delegation: input,
      invocation_context: input.invocation_context,
      projection: input.projection,
      session: run_options.session ?? null,
      onDelta: run_options.onDelta ?? null,
      shouldStop: run_options.shouldStop ?? null,
      runtimeState: run_options.runtimeState ?? null,
    }),
  });
}

export default {
  createExpertChildDelegationExecutor,
};
