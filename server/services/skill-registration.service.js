import fs from 'fs';
import path from 'path';
import Utils from '../../lib/utils.js';
import { getSkillPath, getSkillsPath } from '../../lib/paths.js';
import { SkillDescriptorRunner, validateSkillDefinition } from '../../lib/skill-descriptor-runner.js';

function normalizeLogicalSourcePath(fullPath) {
  const skillsRoot = path.resolve(getSkillsPath());
  const relative = path.relative(skillsRoot, fullPath);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Skill path is outside skills root: ${fullPath}`);
  }
  return `skills/${relative.split(path.sep).join('/')}`;
}

function assertContainedFile(skillRoot, scriptPath) {
  if (typeof scriptPath !== 'string' || !scriptPath.trim() || path.isAbsolute(scriptPath)) {
    throw new Error(`Tool script_path must be a relative path: ${scriptPath || '(missing)'}`);
  }

  const normalized = path.normalize(scriptPath);
  if (normalized === '..' || normalized.startsWith(`..${path.sep}`)) {
    throw new Error(`Tool script_path escapes skill root: ${scriptPath}`);
  }

  const fullPath = path.resolve(skillRoot, normalized);
  const rootWithSeparator = skillRoot.endsWith(path.sep) ? skillRoot : `${skillRoot}${path.sep}`;
  if (!fullPath.startsWith(rootWithSeparator) || !fs.existsSync(fullPath)) {
    throw new Error(`Tool script_path does not exist inside skill root: ${scriptPath}`);
  }

  const realSkillRoot = fs.realpathSync(skillRoot);
  const realFilePath = fs.realpathSync(fullPath);
  const realRootWithSeparator = realSkillRoot.endsWith(path.sep)
    ? realSkillRoot
    : `${realSkillRoot}${path.sep}`;
  if (!realFilePath.startsWith(realRootWithSeparator)) {
    throw new Error(`Tool script_path symlink escapes skill root: ${scriptPath}`);
  }

  return normalized.split(path.sep).join('/');
}

function normalizeParameters(parameters) {
  if (!parameters || typeof parameters !== 'object' || Array.isArray(parameters)) {
    return { type: 'object', properties: {}, required: [] };
  }

  const normalized = {
    ...parameters,
    type: parameters.type || 'object',
  };

  if (normalized.type === 'object') {
    normalized.properties = normalized.properties && typeof normalized.properties === 'object'
      ? normalized.properties
      : {};
    if (Array.isArray(normalized.required)) {
      normalized.required = normalized.required.filter(name => Object.prototype.hasOwnProperty.call(normalized.properties, name));
    } else {
      normalized.required = [];
    }
  }

  return normalized;
}

function normalizeMark(value, fallback) {
  const mark = String(value || fallback || '')
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return mark || fallback;
}

export class SkillRegistrationService {
  constructor(db, options = {}) {
    this.db = db;
    this.Skill = db.getModel('skill');
    this.SkillTool = db.getModel('skill_tool');
    this.descriptorRunner = options.descriptorRunner || new SkillDescriptorRunner(options);
  }

  resolveSkillPath(sourcePath, fullPath = null) {
    const candidate = fullPath || getSkillPath(sourcePath);
    if (!candidate || !path.isAbsolute(candidate)) {
      throw new Error('Skill path must resolve to an absolute path');
    }

    const skillsRoot = fs.realpathSync(getSkillsPath());
    const resolved = fs.realpathSync(candidate);
    const rootWithSeparator = skillsRoot.endsWith(path.sep) ? skillsRoot : `${skillsRoot}${path.sep}`;
    if (resolved !== skillsRoot && !resolved.startsWith(rootWithSeparator)) {
      throw new Error(`Skill path is outside skills root: ${sourcePath || candidate}`);
    }

    return resolved;
  }

  normalizeDescriptor(descriptor, { skillPath, entrypoint, runtime, providedName, providedDescription }) {
    validateSkillDefinition(descriptor, {
      expectedRuntime: runtime,
    });

    const descriptorSkill = descriptor.skill || {};
    const skillId = descriptorSkill.id || path.basename(skillPath);
    const skillName = providedName || descriptorSkill.name || skillId;
    const skillDescription = providedDescription ?? descriptorSkill.description ?? '';
    const defaultScriptPath = descriptorSkill.entrypoint || entrypoint;
    const defaultResident = descriptorSkill.is_resident === true;

    if (!defaultScriptPath) {
      throw new Error('Skill descriptor must provide skill.entrypoint');
    }

    const toolNames = new Set();
    const tools = descriptor.tools.map((rawTool, index) => {
      const tool = rawTool?.function || rawTool;
      const name = tool?.name;
      if (!name || typeof name !== 'string') {
        throw new Error(`Skill descriptor tools[${index}] is missing name`);
      }
      if (toolNames.has(name)) {
        throw new Error(`Duplicate skill tool name: ${name}`);
      }
      toolNames.add(name);

      const scriptPath = assertContainedFile(
        skillPath,
        tool.script_path || defaultScriptPath
      );

      return {
        name,
        description: tool.description || '',
        parameters: normalizeParameters(tool.parameters),
        script_path: scriptPath,
        is_resident: tool.is_resident ?? defaultResident,
      };
    });

    return {
      schema_version: descriptor.schema_version,
      legacy_descriptor: descriptor.legacy_descriptor === true,
      skill: {
        ...descriptorSkill,
        id: skillId,
        name: skillName,
        description: skillDescription,
        version: descriptorSkill.version || '1.0.0',
        runtime: descriptorSkill.runtime || runtime,
        entrypoint: assertContainedFile(skillPath, defaultScriptPath),
        is_resident: defaultResident,
      },
      tools,
    };
  }

  async describe({ sourcePath, fullPath = null, providedName = null, providedDescription = null } = {}) {
    const skillPath = this.resolveSkillPath(sourcePath, fullPath);
    const entrypoint = fs.existsSync(path.join(skillPath, 'index.js')) ? 'index.js' : 'index.py';
    const runtime = path.extname(entrypoint).toLowerCase() === '.py' ? 'python' : 'node';
    const result = await this.descriptorRunner.describe({
      skillPath,
      entrypoint,
      runtime,
    });

    return {
      skillPath,
      sourcePath: normalizeLogicalSourcePath(skillPath),
      descriptor: this.normalizeDescriptor(result.descriptor, {
        skillPath,
        entrypoint,
        runtime,
        providedName,
        providedDescription,
      }),
      stderr: result.stderr,
    };
  }

  async register({ sourcePath, fullPath = null, providedName = null, providedDescription = null } = {}) {
    const described = await this.describe({
      sourcePath,
      fullPath,
      providedName,
      providedDescription,
    });
    const { descriptor, skillPath, sourcePath: normalizedSourcePath } = described;
    const skill = descriptor.skill;

    const existing = await this.Skill.findOne({
      where: { source_path: normalizedSourcePath },
      raw: true,
    }) || await this.Skill.findOne({
      where: { name: skill.name },
      raw: true,
    });

    const skillId = existing?.id || Utils.newID(20);
    const mark = existing?.mark || normalizeMark(skill.id, path.basename(skillPath));
    const skillMdPath = path.join(skillPath, 'SKILL.md');
    const skillMd = fs.existsSync(skillMdPath) ? fs.readFileSync(skillMdPath, 'utf8') : null;
    const transaction = await this.db.sequelize.transaction();

    try {
      await this.Skill.upsert({
        id: skillId,
        name: skill.name,
        mark,
        description: skill.description || '',
        version: skill.version || '1.0.0',
        author: skill.author || '',
        tags: JSON.stringify(Array.isArray(skill.tags) ? skill.tags : []),
        source_type: 'local',
        source_path: normalizedSourcePath,
        skill_md: skillMd,
        is_active: existing?.is_active ?? true,
      }, { transaction });

      await this.Skill.update(
        { updated_at: new Date() },
        { where: { id: skillId }, transaction }
      );

      await this.SkillTool.destroy({
        where: { skill_id: skillId },
        transaction,
      });

      for (const tool of descriptor.tools) {
        await this.SkillTool.create({
          id: Utils.newID(20),
          skill_id: skillId,
          name: tool.name,
          description: tool.description,
          parameters: JSON.stringify(tool.parameters),
          script_path: tool.script_path,
          is_resident: !!tool.is_resident,
        }, { transaction });
      }

      await transaction.commit();
    } catch (error) {
      await transaction.rollback().catch(() => {});
      throw error;
    }

    return {
      skill_id: skillId,
      name: skill.name,
      action: existing ? 'updated' : 'created',
      tools_registered: descriptor.tools.length,
      scenarios: descriptor.skill.scenarios || [],
      legacy_descriptor: descriptor.legacy_descriptor,
      source_path: normalizedSourcePath,
    };
  }
}

export default SkillRegistrationService;
