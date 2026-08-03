import logger from './logger.js';
import CapabilityRegistry, { CAPABILITY_KINDS } from './capability-registry.js';
import { isRetiredSkill } from './retired-skills.js';

const RESIDENT_SCOPE_DECLARATIONS = Object.freeze({
  'agent-child-runner/invoke': Object.freeze({
    scopes: Object.freeze(['internal', 'system']),
    allowedRoles: Object.freeze(['*']),
  }),
  'mcp-client/invoke': Object.freeze({
    scopes: Object.freeze(['system']),
    allowedRoles: Object.freeze(['*']),
  }),
});

export function buildResidentCapabilityId(skillId, toolName) {
  return `resident:${skillId}:${toolName}`;
}

function buildResidentPair(skillId, toolName) {
  return `${skillId}/${toolName}`;
}

export class ResidentCapabilityError extends Error {
  constructor(message, statusCode = 403, code = 'RESIDENT_CAPABILITY_DENIED') {
    super(message);
    this.name = 'ResidentCapabilityError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

/**
 * The only execution gateway for resident calls that originate outside the
 * ToolManager. Registration is derived from active resident DB records, but
 * invocation scope is an explicit code-owned declaration.
 */
export class ResidentCapabilityExecutor {
  constructor(db, options = {}) {
    this.db = db;
    this.Tool = db?.getModel?.('skill_tool') || null;
    this.Skill = db?.getModel?.('skill') || null;
    this.residentSkillManager = options.residentSkillManager || null;
    this.capabilityRegistry = options.capabilityRegistry || new CapabilityRegistry();
    this.initialized = false;
  }

  setResidentSkillManager(manager) {
    this.residentSkillManager = manager || null;
  }

  registerTool({ tool, skill }) {
    if (!tool?.skill_id || !tool?.name || !skill || isRetiredSkill(skill)) {
      return null;
    }

    const pair = buildResidentPair(tool.skill_id, tool.name);
    const declaration = RESIDENT_SCOPE_DECLARATIONS[pair] || { scopes: [], allowedRoles: [] };
    const capabilityId = buildResidentCapabilityId(tool.skill_id, tool.name);

    return this.capabilityRegistry.register({
      id: capabilityId,
      kind: CAPABILITY_KINDS.RESIDENT,
      definition: {
        type: 'function',
        function: {
          name: capabilityId,
          description: tool.description || skill.description || '',
          parameters: this.parseParameters(tool.parameters),
        },
      },
      metadata: {
        skillId: tool.skill_id,
        skillName: skill.name,
        toolName: tool.name,
        scriptPath: tool.script_path || 'index.js',
        scopes: declaration.scopes,
        allowedRoles: declaration.allowedRoles,
      },
    });
  }

  async initialize() {
    if (!this.Tool || !this.Skill) {
      throw new Error('Resident capability registry models are not available');
    }

    const residentTools = await this.Tool.findAll({
      where: { is_resident: true },
      raw: true,
    });
    const skillIds = [...new Set(residentTools.map(tool => tool.skill_id))];
    const skills = skillIds.length > 0
      ? await this.Skill.findAll({
        where: { id: skillIds, is_active: true },
        raw: true,
      })
      : [];
    const skillMap = new Map(skills.map(skill => [skill.id, skill]));

    this.capabilityRegistry.clear();
    for (const tool of residentTools) {
      this.registerTool({ tool, skill: skillMap.get(tool.skill_id) });
    }

    this.initialized = true;
    logger.info(`[ResidentCapabilityExecutor] registered ${this.capabilityRegistry.list({ kind: CAPABILITY_KINDS.RESIDENT }).length} resident capabilities`);
    return this.capabilityRegistry.list({ kind: CAPABILITY_KINDS.RESIDENT, includeDenied: true });
  }

  parseParameters(parameters) {
    if (!parameters) {
      return { type: 'object', properties: {}, required: [] };
    }
    if (typeof parameters === 'object') {
      return parameters;
    }
    try {
      return JSON.parse(parameters);
    } catch {
      return { type: 'object', properties: {}, required: [] };
    }
  }

  getByName(skillId, toolName) {
    return this.capabilityRegistry.get(buildResidentCapabilityId(skillId, toolName));
  }

  resolveCapability({ capabilityId, skillId, toolName }) {
    const resolvedId = capabilityId || (
      skillId && toolName ? buildResidentCapabilityId(skillId, toolName) : null
    );

    if (!resolvedId) {
      throw new ResidentCapabilityError(
        'capability_id or skill_id/tool_name is required',
        400,
        'RESIDENT_CAPABILITY_REQUIRED'
      );
    }

    const capability = this.capabilityRegistry.get(resolvedId);
    if (!capability) {
      throw new ResidentCapabilityError(
        `Resident capability not registered: ${resolvedId}`,
        404,
        'RESIDENT_CAPABILITY_NOT_REGISTERED'
      );
    }

    if (capability.kind !== CAPABILITY_KINDS.RESIDENT) {
      throw new ResidentCapabilityError(
        `Capability is not resident: ${resolvedId}`,
        403,
        'RESIDENT_CAPABILITY_KIND_MISMATCH'
      );
    }

    const registeredSkillId = capability.metadata?.skillId;
    const registeredToolName = capability.metadata?.toolName;
    if ((skillId && skillId !== registeredSkillId) || (toolName && toolName !== registeredToolName)) {
      throw new ResidentCapabilityError(
        `Resident capability identity mismatch: ${resolvedId}`,
        400,
        'RESIDENT_CAPABILITY_IDENTITY_MISMATCH'
      );
    }

    return capability;
  }

  async invoke({
    capabilityId,
    skillId,
    toolName,
    params = {},
    userContext = {},
    authorizationContext = {},
    scope = 'internal',
    timeout = 60000,
  } = {}) {
    const capability = this.resolveCapability({ capabilityId, skillId, toolName });
    const scopes = capability.metadata?.scopes || [];
    if (!scopes.includes(scope)) {
      throw new ResidentCapabilityError(
        `Resident capability is not enabled for scope: ${scope}`,
        403,
        'RESIDENT_CAPABILITY_SCOPE_DENIED'
      );
    }

    const permissionContext = { ...userContext, ...authorizationContext };
    if (!this.capabilityRegistry.isAllowed(capability.id, permissionContext)) {
      throw new ResidentCapabilityError(
        `Permission denied for resident capability: ${capability.id}`,
        403,
        'RESIDENT_CAPABILITY_PERMISSION_DENIED'
      );
    }

    if (!this.residentSkillManager) {
      throw new ResidentCapabilityError(
        'ResidentSkillManager not initialized',
        503,
        'RESIDENT_MANAGER_UNAVAILABLE'
      );
    }

    return this.residentSkillManager.invokeByName(
      capability.metadata.skillId,
      capability.metadata.toolName,
      params,
      userContext,
      timeout,
    );
  }
}

export default ResidentCapabilityExecutor;

