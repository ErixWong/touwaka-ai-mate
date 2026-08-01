/**
 * Expert child Agent runner.
 *
 * Maps a validated child delegation projection into the existing AgentLoop
 * input shape. It intentionally stays internal: target resolution, policy
 * checks, and tool exposure are owned by earlier delegation layers.
 */

import { buildStreamLlmPayload } from '../chat/turn-context-builder.js';
import {
  buildMultimodalMessagesWithAttachments,
  hasDelegationAttachments,
  resolveAgentAttachments,
} from './agent-attachment-resolver.js';

function assertFunction(value, name) {
  if (typeof value !== 'function') {
    throw new Error(`${name} is required`);
  }
}

function assertDelegation(delegation) {
  if (!delegation || typeof delegation !== 'object') {
    throw new Error('delegation is required');
  }
  if (!delegation.callee_definition) {
    throw new Error('delegation.callee_definition is required');
  }
  if (delegation.callee_definition.source_type !== 'expert') {
    throw new Error('expert child runner only supports expert callee definitions');
  }
}

function assertInvocationContext(invocation_context) {
  if (!invocation_context || typeof invocation_context !== 'object') {
    throw new Error('invocation_context is required');
  }
  if (!invocation_context.principal_user_id) {
    throw new Error('invocation_context.principal_user_id is required');
  }
  if (!invocation_context.callee_agent_id) {
    throw new Error('invocation_context.callee_agent_id is required');
  }
}

function assertProjection(projection) {
  if (!projection || typeof projection !== 'object') {
    throw new Error('projection is required');
  }
  if (!Array.isArray(projection.messages) || projection.messages.length === 0) {
    throw new Error('projection.messages is required');
  }
}

function resolveEffectiveScope(delegation, invocation_context) {
  const scope = delegation.effective_scope || invocation_context.capability_scope;
  return scope && typeof scope === 'object' && !Array.isArray(scope) ? scope : {};
}

function buildWorkspaceTaskContext(invocation_context) {
  const workspaceScope = invocation_context?.workspace_scope;
  if (!workspaceScope || typeof workspaceScope !== 'object' || Array.isArray(workspaceScope)) {
    return null;
  }
  if (typeof workspaceScope.workdir !== 'string' || workspaceScope.workdir.trim() === '') {
    return null;
  }

  return {
    workspace_mode: workspaceScope.workspace_mode || 'delegated',
    absolute_workspace_path: workspaceScope.workdir,
    logical_workspace_path: workspaceScope.logical_workdir || workspaceScope.logical_workspace_path || null,
    current_path: workspaceScope.current_path || '',
    user_id: invocation_context.principal_user_id,
    task_id: invocation_context.task_id || null,
    delegated: true,
  };
}

export class ExpertChildAgentRunner {
  constructor({
    agent_loop,
    get_expert_service,
    get_scoped_tools = async () => [],
    resolve_attachments = resolveAgentAttachments,
  } = {}) {
    if (!agent_loop || typeof agent_loop.run !== 'function') {
      throw new Error('agent_loop.run is required');
    }
    assertFunction(get_expert_service, 'get_expert_service');
    assertFunction(get_scoped_tools, 'get_scoped_tools');
    assertFunction(resolve_attachments, 'resolve_attachments');

    this.agent_loop = agent_loop;
    this.get_expert_service = get_expert_service;
    this.get_scoped_tools = get_scoped_tools;
    this.resolve_attachments = resolve_attachments;
  }

  async run({
    delegation,
    invocation_context,
    projection,
    session = null,
    onDelta = null,
    shouldStop = null,
    runtimeState = null,
  } = {}) {
    assertDelegation(delegation);
    assertInvocationContext(invocation_context);
    assertProjection(projection);

    const expertService = await this.get_expert_service(invocation_context.callee_agent_id);
    if (!expertService || typeof expertService.getDefaultModelConfig !== 'function') {
      throw new Error('expertService.getDefaultModelConfig is required');
    }
    if (typeof expertService.getThinkingConfig !== 'function') {
      throw new Error('expertService.getThinkingConfig is required');
    }

    const modelConfig = expertService.getDefaultModelConfig();
    const thinkingConfig = expertService.getThinkingConfig(modelConfig);
    const effective_scope = resolveEffectiveScope(delegation, invocation_context);
    const taskContext = buildWorkspaceTaskContext(invocation_context);
    let currentMessages = projection.messages;

    if (hasDelegationAttachments(delegation)) {
      if (modelConfig?.model_type !== 'multimodal') {
        throw new Error(`Child agent model does not support image attachments: ${modelConfig?.model_name || 'unknown'}`);
      }
      const attachmentResolution = await this.resolve_attachments({
        delegation,
        taskContext,
      });
      currentMessages = buildMultimodalMessagesWithAttachments(projection.messages, attachmentResolution);
    }

    const tools = await this.get_scoped_tools({
      expert_service: expertService,
      delegation,
      invocation_context,
      effective_scope,
      session,
      taskContext,
    });
    const scopedTools = Array.isArray(tools) ? tools : [];
    const llmPayload = buildStreamLlmPayload({
      modelConfig,
      messages: currentMessages,
      tools: scopedTools,
    });

    return this.agent_loop.run(expertService, {
      modelConfig,
      thinkingConfig,
      tools: scopedTools,
      currentMessages,
      llmPayload,
      user_id: invocation_context.principal_user_id,
      expert_id: invocation_context.callee_agent_id,
      taskContext,
      topic_id: invocation_context.topic_id,
      task_id: invocation_context.task_id,
      session,
      request_id: invocation_context.request_id || invocation_context.run_id,
      onDelta,
      shouldStop,
      runtimeState,
      agent_invocation_context: invocation_context,
    });
  }
}

export default ExpertChildAgentRunner;
