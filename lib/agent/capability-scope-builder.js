/**
 * Capability scope helpers for Agent delegation.
 *
 * Effective capabilities are intentionally intersection-based:
 * caller delegable scope ∩ callee declarations ∩ principal permissions
 * ∩ workspace constraints ∩ requested scope.
 */

const ARRAY_CAPABILITY_KEYS = Object.freeze([
  'tools',
  'skills',
  'direct_tools',
  'mcp_servers',
  'document_collections',
]);

const BOOLEAN_CAPABILITY_KEYS = Object.freeze([
  'document_retrieval',
  'can_use_skills',
]);

function uniqueStrings(values) {
  if (!Array.isArray(values)) return [];
  return [...new Set(values.filter(value => typeof value === 'string' && value.trim()).map(value => value.trim()))];
}

function normalizeBoolean(value) {
  return value === true;
}

function normalizeScope(scope = {}) {
  const normalized = {};
  for (const key of ARRAY_CAPABILITY_KEYS) {
    normalized[key] = uniqueStrings(scope[key]);
  }
  for (const key of BOOLEAN_CAPABILITY_KEYS) {
    normalized[key] = normalizeBoolean(scope[key]);
  }
  return normalized;
}

function intersectArrays(scopes, key) {
  if (scopes.length === 0) return [];
  const [first, ...rest] = scopes.map(scope => new Set(scope[key]));
  return [...first].filter(value => rest.every(scopeSet => scopeSet.has(value)));
}

function intersectBooleans(scopes, key) {
  return scopes.length > 0 && scopes.every(scope => scope[key] === true);
}

export function buildDeclaredCapabilityScope(agent_definition = {}) {
  const declarations = agent_definition.capability_declarations || {};
  const skills = Array.isArray(declarations.skills)
    ? declarations.skills
        .map(skill => skill.mark || skill.skill_id)
        .filter(Boolean)
    : [];
  const directTools = declarations.direct_tool?.tool_name
    ? [declarations.direct_tool.tool_name]
    : [];

  return normalizeScope({
    tools: [
      ...skills,
      ...directTools,
    ],
    skills,
    direct_tools: directTools,
    document_retrieval: declarations.document_retrieval?.enabled === true,
    can_use_skills: declarations.can_use_skills === true || skills.length > 0,
  });
}

export function intersectCapabilityScopes({
  caller_scope,
  callee_scope,
  principal_scope,
  workspace_scope,
  requested_scope,
} = {}) {
  const requiredScopes = [
    normalizeScope(caller_scope),
    normalizeScope(callee_scope),
    normalizeScope(principal_scope),
    normalizeScope(workspace_scope),
  ];
  const scopes = requested_scope
    ? [...requiredScopes, normalizeScope(requested_scope)]
    : requiredScopes;

  const effective = {};
  for (const key of ARRAY_CAPABILITY_KEYS) {
    effective[key] = intersectArrays(scopes, key);
  }
  for (const key of BOOLEAN_CAPABILITY_KEYS) {
    effective[key] = intersectBooleans(scopes, key);
  }

  return Object.freeze(effective);
}

export function assertRequestedCapabilitiesAllowed(effective_scope = {}, requested_scope = {}) {
  const effective = normalizeScope(effective_scope);
  const requested = normalizeScope(requested_scope);

  for (const key of ARRAY_CAPABILITY_KEYS) {
    const denied = requested[key].filter(value => !effective[key].includes(value));
    if (denied.length > 0) {
      throw new Error(`Requested capability denied: ${key}=${denied.join(',')}`);
    }
  }

  for (const key of BOOLEAN_CAPABILITY_KEYS) {
    if (requested[key] === true && effective[key] !== true) {
      throw new Error(`Requested capability denied: ${key}`);
    }
  }
}

export default {
  buildDeclaredCapabilityScope,
  intersectCapabilityScopes,
  assertRequestedCapabilitiesAllowed,
};
