/**
 * Cross-runtime SkillDefinition v1 runner.
 *
 * Node skills are loaded by an isolated Node worker. Python skills expose the
 * same function semantics through `index.py --get-definition`.
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const NODE_DESCRIPTOR_WORKER = path.join(__dirname, 'skill-descriptor-worker.js');

const DEFAULT_TIMEOUT_MS = 10000;
const DEFAULT_MAX_OUTPUT_BYTES = 1024 * 1024;

export function resolvePythonCommand() {
  return process.env.PYTHON_PATH || 'python3';
}

function resolveContainedPath(rootPath, relativePath) {
  if (!relativePath || path.isAbsolute(relativePath)) {
    throw new Error(`Entrypoint must be a relative path: ${relativePath || '(missing)'}`);
  }

  const root = path.resolve(rootPath);
  const candidate = path.resolve(root, relativePath);
  const rootWithSeparator = root.endsWith(path.sep) ? root : `${root}${path.sep}`;

  if (candidate !== root && !candidate.startsWith(rootWithSeparator)) {
    throw new Error(`Entrypoint escapes skill root: ${relativePath}`);
  }

  return candidate;
}

function findEntrypoint(skillPath) {
  for (const candidate of ['index.js', 'index.py']) {
    if (fs.existsSync(path.join(skillPath, candidate))) {
      return candidate;
    }
  }

  throw new Error(`No descriptor entrypoint found in ${skillPath}`);
}

function buildDescriptorEnvironment(skillPath, entrypoint, descriptorWorkDir) {
  const allowedKeys = [
    'PATH',
    'PATHEXT',
    'SystemRoot',
    'WINDIR',
    'TEMP',
    'TMP',
    'TMPDIR',
    'LANG',
    'TZ',
    'NODE_ENV',
  ];

  const env = Object.fromEntries(
    allowedKeys
      .filter(key => process.env[key] !== undefined)
      .map(key => [key, process.env[key]])
  );

  return {
    ...env,
    SKILL_DESCRIPTOR_MODE: '1',
    SKILL_PATH: skillPath,
    SCRIPT_PATH: entrypoint,
    PYTHONIOENCODING: 'utf-8',
    DATA_BASE_PATH: descriptorWorkDir,
    WORKING_DIRECTORY: descriptorWorkDir,
  };
}

function runProcess(command, args, options) {
  const {
    cwd,
    env,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    maxOutputBytes = DEFAULT_MAX_OUTPUT_BYTES,
  } = options;

  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });

    let stdout = '';
    let stderr = '';
    let outputBytes = 0;
    let settled = false;
    let timedOut = false;
    let outputExceeded = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeoutMs);

    const rejectOnce = error => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        reject(error);
      }
    };

    const appendOutput = (target, chunk) => {
      const text = chunk.toString();
      outputBytes += Buffer.byteLength(text);
      if (outputBytes > maxOutputBytes) {
        outputExceeded = true;
        child.kill();
        return target;
      }
      return target + text;
    };

    child.stdout.on('data', chunk => {
      stdout = appendOutput(stdout, chunk);
    });

    child.stderr.on('data', chunk => {
      stderr = appendOutput(stderr, chunk);
    });

    child.on('error', error => {
      rejectOnce(new Error(`Failed to spawn descriptor process: ${error.message}`));
    });

    child.on('close', code => {
      if (settled) return;

      settled = true;
      clearTimeout(timer);

      if (timedOut) {
        reject(new Error(`Skill descriptor timed out after ${timeoutMs}ms`));
        return;
      }

      if (outputExceeded) {
        reject(new Error(`Skill descriptor output exceeded ${maxOutputBytes} bytes`));
        return;
      }

      if (code !== 0) {
        const detail = stderr.trim() || stdout.trim() || `exit code ${code}`;
        reject(new Error(`Skill descriptor process failed: ${detail}`));
        return;
      }

      let descriptor;
      try {
        descriptor = JSON.parse(stdout);
      } catch (error) {
        reject(new Error(`Skill descriptor returned invalid JSON: ${error.message}`));
        return;
      }

      resolve({ descriptor, stderr });
    });
  });
}

function inferRuntime(entrypoint, runtime) {
  if (runtime) return runtime;
  return path.extname(entrypoint).toLowerCase() === '.py' ? 'python' : 'node';
}

function assertRelativeScriptPath(scriptPath, fieldName) {
  if (typeof scriptPath !== 'string' || !scriptPath.trim() || path.isAbsolute(scriptPath)) {
    throw new Error(`${fieldName} must be a non-empty relative path`);
  }

  const normalized = path.normalize(scriptPath);
  if (normalized === '..' || normalized.startsWith(`..${path.sep}`)) {
    throw new Error(`${fieldName} escapes the skill root: ${scriptPath}`);
  }
}

export function validateSkillDefinition(descriptor, options = {}) {
  const { allowLegacy = true, expectedSkillId = null, expectedRuntime = null } = options;

  if (!descriptor || typeof descriptor !== 'object' || Array.isArray(descriptor)) {
    throw new Error('Skill descriptor must be a JSON object');
  }

  const isLegacy = descriptor.legacy_descriptor === true || descriptor.schema_version === 0;
  if (descriptor.schema_version !== 1 && !(allowLegacy && isLegacy)) {
    throw new Error(`Unsupported SkillDefinition schema_version: ${descriptor.schema_version}`);
  }

  if (!descriptor.skill || typeof descriptor.skill !== 'object') {
    throw new Error('Skill descriptor must contain a skill object');
  }

  const { skill } = descriptor;
  if (typeof skill.id !== 'string' || !skill.id.trim()) {
    throw new Error('Skill descriptor skill.id is required');
  }

  if (expectedSkillId && skill.id !== expectedSkillId) {
    throw new Error(`Skill descriptor id mismatch: expected ${expectedSkillId}, received ${skill.id}`);
  }

  if (expectedRuntime && skill.runtime && skill.runtime !== expectedRuntime) {
    throw new Error(`Skill descriptor runtime mismatch: expected ${expectedRuntime}, received ${skill.runtime}`);
  }

  if (skill.entrypoint !== undefined) {
    assertRelativeScriptPath(skill.entrypoint, 'skill.entrypoint');
  } else if (!isLegacy) {
    throw new Error('Skill descriptor skill.entrypoint is required');
  }

  if (!Array.isArray(descriptor.tools)) {
    throw new Error('Skill descriptor tools must be an array');
  }

  const names = new Set();
  for (const [index, tool] of descriptor.tools.entries()) {
    if (!tool || typeof tool !== 'object') {
      throw new Error(`Skill descriptor tools[${index}] must be an object`);
    }
    if (typeof tool.name !== 'string' || !tool.name.trim()) {
      throw new Error(`Skill descriptor tools[${index}].name is required`);
    }
    if (names.has(tool.name)) {
      throw new Error(`Duplicate skill tool name: ${tool.name}`);
    }
    names.add(tool.name);

    if (tool.description !== undefined && typeof tool.description !== 'string') {
      throw new Error(`Skill descriptor tools[${index}].description must be a string`);
    }
    if (tool.parameters !== undefined && (!tool.parameters || typeof tool.parameters !== 'object' || Array.isArray(tool.parameters))) {
      throw new Error(`Skill descriptor tools[${index}].parameters must be an object`);
    }
    if (tool.script_path !== undefined) {
      assertRelativeScriptPath(tool.script_path, `tools[${index}].script_path`);
    } else if (!isLegacy && !skill.entrypoint) {
      throw new Error(`Skill descriptor tools[${index}].script_path is required when skill.entrypoint is missing`);
    }
    if (tool.is_resident !== undefined && typeof tool.is_resident !== 'boolean') {
      throw new Error(`Skill descriptor tools[${index}].is_resident must be boolean`);
    }
  }

  return descriptor;
}

export class SkillDescriptorRunner {
  constructor(options = {}) {
    this.pythonCommand = options.pythonCommand || resolvePythonCommand();
    this.timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS;
    this.maxOutputBytes = options.maxOutputBytes || DEFAULT_MAX_OUTPUT_BYTES;
  }

  async describe({ skillPath, entrypoint = null, runtime = null } = {}) {
    if (!skillPath || !path.isAbsolute(skillPath)) {
      throw new Error('skillPath must be an absolute path');
    }

    const resolvedSkillPath = fs.realpathSync(skillPath);
    const resolvedEntrypoint = entrypoint || findEntrypoint(resolvedSkillPath);
    const entryPath = resolveContainedPath(resolvedSkillPath, resolvedEntrypoint);
    const scriptRuntime = inferRuntime(resolvedEntrypoint, runtime);
    const descriptorWorkDir = fs.mkdtempSync(path.join(os.tmpdir(), 'touwaka-skill-descriptor-'));
    const env = buildDescriptorEnvironment(resolvedSkillPath, resolvedEntrypoint, descriptorWorkDir);

    try {
      if (scriptRuntime === 'node') {
        const result = await runProcess(
          process.execPath,
          [NODE_DESCRIPTOR_WORKER, resolvedSkillPath, resolvedEntrypoint],
          {
            cwd: resolvedSkillPath,
            env,
            timeoutMs: this.timeoutMs,
            maxOutputBytes: this.maxOutputBytes,
          }
        );
        validateSkillDefinition(result.descriptor, {
          expectedRuntime: 'node',
        });
        return result;
      }

      if (scriptRuntime === 'python') {
        const result = await runProcess(
          this.pythonCommand,
          [entryPath, '--get-definition'],
          {
            cwd: resolvedSkillPath,
            env,
            timeoutMs: this.timeoutMs,
            maxOutputBytes: this.maxOutputBytes,
          }
        );
        validateSkillDefinition(result.descriptor, {
          expectedRuntime: 'python',
        });
        return result;
      }

      throw new Error(`Unsupported descriptor runtime: ${scriptRuntime}`);
    } finally {
      fs.rmSync(descriptorWorkDir, { recursive: true, force: true });
    }
  }
}

export default SkillDescriptorRunner;
