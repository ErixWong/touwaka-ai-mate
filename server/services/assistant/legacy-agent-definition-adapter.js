/**
 * Legacy Assistant -> AgentDefinition adapter.
 */

import { AGENT_SOURCE_TYPES, deepFreezeDefinition, validateAgentDefinition } from '../../../lib/agent/agent-definition-resolver.js';
import { buildModelConfigView } from '../../../lib/agent/model-config-view.js';
import { getAssistantDetail } from './config-repository.js';

function parseJsonObject(value) {
  if (!value) return null;
  if (typeof value === 'object' && !Array.isArray(value)) return value;
  if (typeof value !== 'string') return null;

  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed
      : null;
  } catch {
    return null;
  }
}

function normalizeNumber(value, fallback = null) {
  if (value === null || value === undefined || value === '') return fallback;
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : fallback;
}

export function buildLegacyAssistantAgentDefinition(assistant, modelConfig = null, options = {}) {
  if (!assistant) {
    return null;
  }

  const executionMode = assistant.execution_mode || 'llm';
  const toolParameters = parseJsonObject(assistant.tool_parameters);

  const definition = {
    agent_id: assistant.id,
    source_type: AGENT_SOURCE_TYPES.legacy_assistant,
    display_name: assistant.name,
    description: assistant.description || '',
    system_prompt: assistant.prompt_template || '',
    model_config: {
      primary_model: buildModelConfigView(modelConfig, options),
      reflective_model: null,
    },
    context_policy: {
      timeout_seconds: normalizeNumber(assistant.timeout, null),
      estimated_time_seconds: normalizeNumber(assistant.estimated_time, null),
    },
    capability_declarations: {
      can_use_skills: Boolean(assistant.can_use_skills),
      direct_tool: assistant.tool_name
        ? {
            tool_name: assistant.tool_name,
            description: assistant.tool_description || '',
            parameters: toolParameters,
          }
        : null,
    },
    execution_policy: {
      mode: executionMode,
      max_output_tokens: normalizeNumber(assistant.max_tokens, null),
      temperature: normalizeNumber(assistant.temperature, null),
      timeout_seconds: normalizeNumber(assistant.timeout, null),
      supports_delegation: executionMode === 'llm',
      legacy: true,
    },
    is_active: assistant.is_active !== false,
    source_record: assistant,
  };

  validateAgentDefinition(definition);
  return deepFreezeDefinition(definition);
}

export class LegacyAssistantAgentDefinitionAdapter {
  constructor(db) {
    this.db = db;
  }

  async resolve(agent_id, options = {}) {
    const assistant = await getAssistantDetail(this.db, agent_id);
    if (!assistant) {
      return null;
    }

    const modelConfig = assistant.model_id
      ? await this.db.getModelConfig(assistant.model_id)
      : null;
    return buildLegacyAssistantAgentDefinition(assistant, modelConfig, options);
  }
}

export default LegacyAssistantAgentDefinitionAdapter;
