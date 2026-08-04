/**
 * In-process capability registry.
 *
 * This is deliberately an execution-layer registry, not a second database
 * authority. SkillLoader and ResidentSkillManager remain responsible for
 * loading their sources; this registry gives ToolManager one index for
 * exposure policy and dispatch metadata.
 */

export const CAPABILITY_KINDS = Object.freeze({
  BUILTIN: 'builtin',
  SKILL: 'skill',
  RESIDENT: 'resident',
  MCP: 'mcp',
  AGENT: 'agent',
});

function resolveRoles(context = {}) {
  const sessionRoles = context?.session?.roles;
  const contextRoles = context?.roles;
  const rawRoles = Array.isArray(sessionRoles)
    ? sessionRoles
    : Array.isArray(contextRoles)
      ? contextRoles
      : [];

  return new Set(['user', ...rawRoles]);
}

export function isCapabilityAllowed(capability, context = {}) {
  const allowedRoles = capability?.metadata?.allowedRoles;
  if (!Array.isArray(allowedRoles) || allowedRoles.length === 0) {
    return true;
  }

  const roles = resolveRoles(context);
  return allowedRoles.includes('*') || allowedRoles.some(role => roles.has(role));
}

export class CapabilityRegistry {
  constructor() {
    this.entries = new Map();
  }

  clear() {
    this.entries.clear();
  }

  register({ id, kind, definition, metadata = {}, executor = null }) {
    if (!id || typeof id !== 'string') {
      throw new Error('Capability id must be a non-empty string');
    }
    if (!kind || typeof kind !== 'string') {
      throw new Error(`Capability kind is required for ${id}`);
    }
    if (!definition || typeof definition !== 'object') {
      throw new Error(`Capability definition is required for ${id}`);
    }

    const entry = {
      id,
      kind,
      definition,
      metadata: { ...metadata },
      executor,
    };
    this.entries.set(id, entry);
    return entry;
  }

  registerMany(capabilities = []) {
    for (const capability of capabilities) {
      this.register(capability);
    }
  }

  unregister(id) {
    return this.entries.delete(id);
  }

  get(id) {
    return this.entries.get(id) || null;
  }

  has(id) {
    return this.entries.has(id);
  }

  isAllowed(id, context = {}) {
    const capability = this.get(id);
    return Boolean(capability) && isCapabilityAllowed(capability, context);
  }

  list({ kind = null, context = {}, includeDenied = false } = {}) {
    return Array.from(this.entries.values()).filter(entry => {
      if (kind && entry.kind !== kind) return false;
      return includeDenied || isCapabilityAllowed(entry, context);
    });
  }
}

export default CapabilityRegistry;
