/**
 * Child Agent executor adapter.
 *
 * This adapter bridges an accepted delegation envelope to AgentRuntime.runChild().
 * It deliberately does not resolve targets, widen capability scope, expose an
 * LLM tool, or run an LLM by itself.
 */

import { buildChildAgentRunProjection } from './child-run-projection.js';

function assertFunction(value, name) {
  if (typeof value !== 'function') {
    throw new Error(`${name} is required`);
  }
}

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
}

export class ChildAgentExecutor {
  constructor({
    agent_runtime,
    run_child,
    projection_builder = buildChildAgentRunProjection,
  } = {}) {
    if (!agent_runtime || typeof agent_runtime.runChild !== 'function') {
      throw new Error('agent_runtime.runChild is required');
    }
    assertFunction(run_child, 'run_child');
    assertFunction(projection_builder, 'projection_builder');

    this.agent_runtime = agent_runtime;
    this.run_child = run_child;
    this.projection_builder = projection_builder;
  }

  async execute(delegation) {
    assertDelegation(delegation);
    const projection = this.projection_builder(delegation);

    return this.agent_runtime.runChild({
      invocation_context: delegation.child_invocation,
    }, ({ invocation_context }) => this.run_child({
      ...delegation,
      invocation_context,
      projection,
    }));
  }
}

export default ChildAgentExecutor;
