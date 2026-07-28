/**
 * Agent runtime facade.
 *
 * Phase A keeps the existing root chat LLM loop intact and wraps it with the
 * shared Agent invocation/event boundary. Child runs use the same lifecycle
 * facade, but delegation/tool wiring stays outside this module.
 */

import { buildAgentEvent } from './agent-event.js';
import { buildRootAgentInvocationContext } from './agent-invocation-context.js';

function defaultIsCancelledError(error) {
  return error?.message === 'Request aborted by user' || error?.name === 'AbortError';
}

function buildCompletionPayload(result = {}) {
  const tokenUsage = result?.tokenUsage || null;
  const allToolCalls = Array.isArray(result?.allToolCalls) ? result.allToolCalls : [];

  return {
    llm_calls_count: Number.isInteger(result?.llmCallsCount) ? result.llmCallsCount : null,
    tool_call_count: allToolCalls.length,
    has_content: Boolean(result?.fullContent && String(result.fullContent).trim()),
    has_reasoning_content: Boolean(result?.fullReasoningContent && String(result.fullReasoningContent).trim()),
    token_usage: tokenUsage ? {
      prompt_tokens: tokenUsage.prompt_tokens || 0,
      completion_tokens: tokenUsage.completion_tokens || 0,
      total_tokens: tokenUsage.total_tokens || 0,
    } : null,
  };
}

function assertExecutor(executor) {
  if (typeof executor !== 'function') {
    throw new Error('executor is required');
  }
}

function attachInvocationContext(result, invocation_context) {
  if (result && typeof result === 'object' && !Array.isArray(result)) {
    return {
      ...result,
      agent_invocation_context: invocation_context,
    };
  }

  return {
    result,
    agent_invocation_context: invocation_context,
  };
}

function assertChildInvocationContext(invocation_context) {
  if (!invocation_context || typeof invocation_context !== 'object') {
    throw new Error('child invocation_context is required');
  }
  if (!invocation_context.parent_run_id) {
    throw new Error('child invocation_context.parent_run_id is required');
  }
  if (!invocation_context.caller_agent_id) {
    throw new Error('child invocation_context.caller_agent_id is required');
  }
  if (!Number.isInteger(invocation_context.delegation_depth) || invocation_context.delegation_depth < 1) {
    throw new Error('child invocation_context.delegation_depth must be at least 1');
  }
}

export class AgentRuntime {
  constructor({
    event_sink = null,
    is_cancelled_error = defaultIsCancelledError,
  } = {}) {
    this.event_sink = event_sink;
    this.is_cancelled_error = is_cancelled_error;
  }

  async runRoot(input = {}, executor) {
    assertExecutor(executor);
    const invocation_context = input.invocation_context || buildRootAgentInvocationContext(input);

    return this.runWithContext(invocation_context, executor);
  }

  async runChild(input = {}, executor) {
    assertExecutor(executor);
    const invocation_context = input.invocation_context || input.child_invocation;
    assertChildInvocationContext(invocation_context);

    return this.runWithContext(invocation_context, executor);
  }

  async runWithContext(invocation_context, executor) {
    await this.emit('agent_run_created', invocation_context, {
      source: invocation_context.source,
    });
    await this.emit('agent_run_started', invocation_context);

    try {
      const result = await executor({ invocation_context });
      await this.emit('agent_run_completed', invocation_context, buildCompletionPayload(result));

      return attachInvocationContext(result, invocation_context);
    } catch (error) {
      const eventType = this.is_cancelled_error(error) ? 'agent_run_cancelled' : 'agent_run_failed';
      await this.emit(eventType, invocation_context, {
        error: error?.message || String(error),
      });
      throw error;
    }
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

export default AgentRuntime;
