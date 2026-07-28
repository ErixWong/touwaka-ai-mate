/**
 * Agent delegation control facade.
 *
 * Internal, unregistered facade for the future agent_delegate tool surface.
 * It delegates policy decisions to AgentDelegationService and execution state
 * to ChildRunScheduler.
 */

export const AGENT_DELEGATE_TOOL_NAMES = Object.freeze({
  START: 'agent_delegate_start',
  STATUS: 'agent_delegate_status',
  RESULT: 'agent_delegate_result',
  CANCEL: 'agent_delegate_cancel',
});

function assertService(value, methodName, name) {
  if (!value || typeof value[methodName] !== 'function') {
    throw new Error(`${name}.${methodName} is required`);
  }
}

function assertString(value, name) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${name} is required`);
  }
}

function normalizeObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function normalizeNullableString(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function buildStartToolDefinition() {
  return {
    type: 'function',
    function: {
      name: AGENT_DELEGATE_TOOL_NAMES.START,
      description: 'Start an asynchronous child agent run for a delegated task.',
      parameters: {
        type: 'object',
        properties: {
          source_type: {
            type: 'string',
            enum: ['expert'],
            description: 'Child agent source type. Only expert is supported in the current runtime.',
          },
          agent_id: {
            type: 'string',
            description: 'Target child agent id.',
          },
          task: {
            type: 'string',
            description: 'Delegated task for the child agent.',
          },
          input: {
            type: 'object',
            description: 'Structured task input for the child agent.',
          },
          expected_output: {
            type: 'string',
            description: 'Expected child output format or acceptance criteria.',
          },
          requested_scope: {
            type: 'object',
            description: 'Requested delegated capability scope.',
          },
        },
        required: ['source_type', 'agent_id', 'task'],
      },
    },
  };
}

function buildChildRunIdToolDefinition(name, description) {
  return {
    type: 'function',
    function: {
      name,
      description,
      parameters: {
        type: 'object',
        properties: {
          child_run_id: {
            type: 'string',
            description: 'Child agent run id returned by agent_delegate_start.',
          },
        },
        required: ['child_run_id'],
      },
    },
  };
}

export function buildAgentDelegateControlToolDefinitions() {
  return Object.freeze([
    Object.freeze(buildStartToolDefinition()),
    Object.freeze(buildChildRunIdToolDefinition(
      AGENT_DELEGATE_TOOL_NAMES.STATUS,
      'Get the current status of an asynchronous child agent run.',
    )),
    Object.freeze(buildChildRunIdToolDefinition(
      AGENT_DELEGATE_TOOL_NAMES.RESULT,
      'Read the completed result and events for a child agent run.',
    )),
    Object.freeze(buildChildRunIdToolDefinition(
      AGENT_DELEGATE_TOOL_NAMES.CANCEL,
      'Request cancellation for a running child agent run.',
    )),
  ]);
}

export class AgentDelegateControlFacade {
  constructor({
    delegation_service,
    child_run_scheduler,
  } = {}) {
    assertService(delegation_service, 'delegate', 'delegation_service');
    assertService(child_run_scheduler, 'start', 'child_run_scheduler');
    assertService(child_run_scheduler, 'getStatus', 'child_run_scheduler');
    assertService(child_run_scheduler, 'getResult', 'child_run_scheduler');
    assertService(child_run_scheduler, 'cancel', 'child_run_scheduler');

    this.delegation_service = delegation_service;
    this.child_run_scheduler = child_run_scheduler;
  }

  getToolDefinitions() {
    return buildAgentDelegateControlToolDefinitions();
  }

  async start(params = {}, context = {}) {
    if (!context.parent_invocation) {
      throw new Error('context.parent_invocation is required');
    }
    assertString(params.source_type, 'params.source_type');
    assertString(params.agent_id, 'params.agent_id');
    assertString(params.task, 'params.task');

    const delegation = await this.delegation_service.delegate({
      parent_invocation: context.parent_invocation,
      target: {
        source_type: params.source_type,
        agent_id: params.agent_id,
      },
      task: params.task,
      input: normalizeObject(params.input),
      expected_output: normalizeNullableString(params.expected_output),
      requested_scope: params.requested_scope ? normalizeObject(params.requested_scope) : null,
      caller_scope: normalizeObject(context.caller_scope),
      principal_scope: normalizeObject(context.principal_scope),
      workspace_scope: normalizeObject(context.workspace_scope),
      invocation_mode: 'llm',
      source: 'agent_delegate',
    });
    const run = await this.child_run_scheduler.start(delegation, {
      session: context.session ?? null,
    });

    return Object.freeze({
      child_run_id: run.child_run_id,
      status: run.status,
      run,
    });
  }

  async status(params = {}) {
    assertString(params.child_run_id, 'params.child_run_id');
    return await this.child_run_scheduler.getStatus(params.child_run_id);
  }

  async result(params = {}) {
    assertString(params.child_run_id, 'params.child_run_id');
    return await this.child_run_scheduler.getResult(params.child_run_id);
  }

  async cancel(params = {}) {
    assertString(params.child_run_id, 'params.child_run_id');
    return await this.child_run_scheduler.cancel(params.child_run_id);
  }

  async handleToolCall(tool_name, params = {}, context = {}) {
    try {
      switch (tool_name) {
        case AGENT_DELEGATE_TOOL_NAMES.START:
          return { success: true, data: await this.start(params, context) };
        case AGENT_DELEGATE_TOOL_NAMES.STATUS:
          return { success: true, data: await this.status(params) };
        case AGENT_DELEGATE_TOOL_NAMES.RESULT:
          return { success: true, data: await this.result(params) };
        case AGENT_DELEGATE_TOOL_NAMES.CANCEL:
          return { success: true, data: await this.cancel(params) };
        default:
          throw new Error(`Unknown agent delegate control tool: ${tool_name}`);
      }
    } catch (error) {
      return {
        success: false,
        error: error?.message || String(error),
      };
    }
  }
}

export default {
  AGENT_DELEGATE_TOOL_NAMES,
  AgentDelegateControlFacade,
  buildAgentDelegateControlToolDefinitions,
};
