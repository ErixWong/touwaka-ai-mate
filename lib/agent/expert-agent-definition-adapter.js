/**
 * Expert -> AgentDefinition adapter.
 */

import { AGENT_SOURCE_TYPES, deepFreezeDefinition, validateAgentDefinition } from './agent-definition-resolver.js';
import { buildModelConfigView } from './model-config-view.js';

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

function mapSkillDeclaration(skill) {
  return {
    skill_id: skill.id || skill.skill_id,
    name: skill.name || null,
    mark: skill.mark || null,
    source_type: skill.source_type || null,
    user_invocable: skill.user_invocable ?? null,
    disable_model_invocation: skill.disable_model_invocation ?? null,
    allowed_tools: skill.allowed_tools || null,
  };
}

export function buildExpertAgentDefinition(config, options = {}) {
  const expert = config?.expert;
  if (!expert) {
    return null;
  }

  const knowledgeConfig = parseJsonObject(expert.knowledge_config);
  const psycheConfig = parseJsonObject(expert.psyche_config);
  const skills = Array.isArray(config.skills) ? config.skills : [];

  const definition = {
    agent_id: expert.id,
    source_type: AGENT_SOURCE_TYPES.expert,
    display_name: expert.name,
    description: expert.introduction || '',
    system_prompt: expert.prompt_template || expert.system_prompt || expert.introduction || '',
    model_config: {
      primary_model: buildModelConfigView(config.expressiveModel, options),
      reflective_model: buildModelConfigView(config.reflectiveModel, options),
    },
    context_policy: {
      context_strategy: expert.context_strategy || 'full',
      context_threshold: normalizeNumber(expert.context_threshold, null),
      psyche_config: psycheConfig,
      knowledge_config: knowledgeConfig,
    },
    capability_declarations: {
      skills: skills.map(mapSkillDeclaration),
      document_retrieval: {
        enabled: Boolean(knowledgeConfig?.enabled),
        kb_id: knowledgeConfig?.kb_id || null,
      },
    },
    execution_policy: {
      mode: 'llm',
      max_tool_rounds: normalizeNumber(expert.max_tool_rounds, null),
      temperature: normalizeNumber(expert.temperature, null),
      reflective_temperature: normalizeNumber(expert.reflective_temperature, null),
      supports_delegation: true,
    },
    is_active: expert.is_active !== false,
    source_record: expert,
  };

  validateAgentDefinition(definition);
  return deepFreezeDefinition(definition);
}

export class ExpertAgentDefinitionAdapter {
  constructor(db) {
    this.db = db;
  }

  async resolve(agent_id, options = {}) {
    const config = await this.db.getExpertFullConfig(agent_id);
    return buildExpertAgentDefinition(config, options);
  }
}

export default ExpertAgentDefinitionAdapter;
