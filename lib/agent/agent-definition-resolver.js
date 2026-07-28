/**
 * Agent definition resolver.
 *
 * The resolver coordinates source-specific adapters and returns a readonly
 * AgentDefinition shape. It does not own persistence or execution.
 */

export const AGENT_SOURCE_TYPES = Object.freeze({
  expert: 'expert',
  legacy_assistant: 'legacy_assistant',
});

function assertAdapter(adapter, sourceType) {
  if (!adapter || typeof adapter.resolve !== 'function') {
    throw new Error(`Agent definition adapter missing resolve(): ${sourceType}`);
  }
}

export class AgentDefinitionResolver {
  constructor(adapters = {}) {
    this.adapters = new Map();

    for (const [sourceType, adapter] of Object.entries(adapters)) {
      this.register(sourceType, adapter);
    }
  }

  register(source_type, adapter) {
    if (!source_type) {
      throw new Error('source_type is required');
    }
    assertAdapter(adapter, source_type);
    this.adapters.set(source_type, adapter);
  }

  async resolve({ source_type, agent_id, options = {} } = {}) {
    if (!source_type) {
      throw new Error('source_type is required');
    }
    if (!agent_id) {
      throw new Error('agent_id is required');
    }

    const adapter = this.adapters.get(source_type);
    if (!adapter) {
      throw new Error(`Unsupported agent source_type: ${source_type}`);
    }

    const definition = await adapter.resolve(agent_id, options);
    if (!definition) {
      return null;
    }

    validateAgentDefinition(definition);
    return deepFreezeDefinition(definition);
  }
}

export function validateAgentDefinition(definition) {
  if (!definition || typeof definition !== 'object') {
    throw new Error('AgentDefinition must be an object');
  }
  for (const field of ['agent_id', 'source_type', 'display_name', 'execution_policy']) {
    if (!definition[field]) {
      throw new Error(`AgentDefinition missing required field: ${field}`);
    }
  }
  if (!definition.execution_policy.mode) {
    throw new Error('AgentDefinition execution_policy.mode is required');
  }
}

export function deepFreezeDefinition(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) {
    return value;
  }

  for (const child of Object.values(value)) {
    deepFreezeDefinition(child);
  }
  return Object.freeze(value);
}

export default AgentDefinitionResolver;
