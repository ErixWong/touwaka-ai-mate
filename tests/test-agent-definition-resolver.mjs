/**
 * Tests for AgentDefinition resolver and source adapters.
 *
 * Usage:
 *   node tests/test-agent-definition-resolver.mjs
 */

import assert from 'node:assert/strict';
import {
  AgentDefinitionResolver,
  AGENT_SOURCE_TYPES,
} from '../lib/agent/agent-definition-resolver.js';
import {
  buildExpertAgentDefinition,
  ExpertAgentDefinitionAdapter,
} from '../lib/agent/expert-agent-definition-adapter.js';

function createExpertConfig() {
  return {
    expert: {
      id: 'expert_1',
      name: 'Research Expert',
      introduction: 'Helps with research.',
      prompt_template: 'You are precise.',
      expressive_model_id: 'model_primary',
      reflective_model_id: 'model_reflective',
      context_strategy: 'minimal',
      context_threshold: '0.75',
      psyche_config: JSON.stringify({ enable_notes: true }),
      knowledge_config: JSON.stringify({ enabled: true, kb_id: 'kb_1' }),
      max_tool_rounds: 8,
      temperature: '0.65',
      reflective_temperature: '0.25',
      is_active: true,
    },
    expressiveModel: { id: 'model_primary', model_name: 'primary', api_key: 'secret_primary' },
    reflectiveModel: { id: 'model_reflective', model_name: 'reflective' },
    skills: [{
      id: 'skill_1',
      name: 'Search',
      mark: 'search',
      source_type: 'builtin',
      user_invocable: true,
    }],
  };
}

function testBuildExpertDefinition() {
  const definition = buildExpertAgentDefinition(createExpertConfig());

  assert.equal(definition.agent_id, 'expert_1');
  assert.equal(definition.source_type, AGENT_SOURCE_TYPES.expert);
  assert.equal(definition.display_name, 'Research Expert');
  assert.equal(definition.system_prompt, 'You are precise.');
  assert.deepEqual(definition.model_config.primary_model, { id: 'model_primary', model_name: 'primary' });
  assert.equal(definition.model_config.primary_model.api_key, undefined);
  assert.deepEqual(definition.context_policy.psyche_config, { enable_notes: true });
  assert.deepEqual(definition.context_policy.knowledge_config, { enabled: true, kb_id: 'kb_1' });
  assert.equal(definition.context_policy.context_threshold, 0.75);
  assert.equal(definition.execution_policy.mode, 'llm');
  assert.equal(definition.execution_policy.max_tool_rounds, 8);
  assert.equal(definition.execution_policy.supports_delegation, true);
  assert.deepEqual(definition.capability_declarations.skills, [{
    skill_id: 'skill_1',
    name: 'Search',
    mark: 'search',
    source_type: 'builtin',
    user_invocable: true,
    disable_model_invocation: null,
    allowed_tools: null,
  }]);
  assert.equal(Object.isFrozen(definition), true);
}

async function testResolverDispatchesAdapters() {
  const resolver = new AgentDefinitionResolver({
    [AGENT_SOURCE_TYPES.expert]: {
      async resolve(agentId) {
        return buildExpertAgentDefinition({
          ...createExpertConfig(),
          expert: {
            ...createExpertConfig().expert,
            id: agentId,
          },
        });
      },
    },
  });

  const definition = await resolver.resolve({
    source_type: AGENT_SOURCE_TYPES.expert,
    agent_id: 'expert_from_resolver',
  });

  assert.equal(definition.agent_id, 'expert_from_resolver');
  await assert.rejects(() => resolver.resolve({
    source_type: 'missing',
    agent_id: 'agent_1',
  }), /Unsupported agent source_type/);
}

async function testExpertAdapterUsesDbConfig() {
  const adapter = new ExpertAgentDefinitionAdapter({
    async getExpertFullConfig(agentId) {
      return {
        ...createExpertConfig(),
        expert: {
          ...createExpertConfig().expert,
          id: agentId,
        },
      };
    },
  });

  const definition = await adapter.resolve('expert_db');
  assert.equal(definition.agent_id, 'expert_db');
}

function testCanIncludeSensitiveModelConfigWhenExplicit() {
  const definition = buildExpertAgentDefinition(createExpertConfig(), {
    include_sensitive_model_config: true,
  });

  assert.equal(definition.model_config.primary_model.api_key, 'secret_primary');
}

async function main() {
  testBuildExpertDefinition();
  await testResolverDispatchesAdapters();
  await testExpertAdapterUsesDbConfig();
  testCanIncludeSensitiveModelConfigWhenExplicit();

  console.log('Agent definition resolver tests passed.');
}

main();
