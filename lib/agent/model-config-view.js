/**
 * Model config view helpers for AgentDefinition.
 */

const SENSITIVE_MODEL_FIELDS = new Set(['api_key']);

export function buildModelConfigView(modelConfig, options = {}) {
  if (!modelConfig || typeof modelConfig !== 'object') {
    return null;
  }
  if (options.include_sensitive_model_config) {
    return { ...modelConfig };
  }

  const view = {};
  for (const [key, value] of Object.entries(modelConfig)) {
    if (!SENSITIVE_MODEL_FIELDS.has(key)) {
      view[key] = value;
    }
  }
  return view;
}

export default {
  buildModelConfigView,
};
