/**
 * Isolated Node adapter for SkillDefinition v1 discovery.
 *
 * Usage: node skill-descriptor-worker.js <skill-root> <entrypoint>
 * stdout is reserved for exactly one JSON descriptor; logs go to stderr.
 */

import fs from 'fs';
import path from 'path';
import vm from 'vm';
import { createRequire } from 'module';
import { pathToFileURL } from 'url';

const [skillRootArg, entrypointArg] = process.argv.slice(2);

function fail(message, error = null) {
  const detail = error?.stack || error?.message || error;
  process.stderr.write(`[skill-descriptor-worker] ${message}${detail ? `: ${detail}` : ''}\n`);
  process.exitCode = 1;
}

function assertContainedPath(rootPath, candidatePath) {
  const root = path.resolve(rootPath);
  const candidate = path.resolve(candidatePath);
  const rootWithSeparator = root.endsWith(path.sep) ? root : `${root}${path.sep}`;

  if (candidate !== root && !candidate.startsWith(rootWithSeparator)) {
    throw new Error(`Entrypoint escapes skill root: ${candidate}`);
  }

  return candidate;
}

function createDescriptorEnv() {
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
    'DATA_BASE_PATH',
    'WORKING_DIRECTORY',
  ];

  return Object.fromEntries(
    allowedKeys
      .filter(key => process.env[key] !== undefined)
      .map(key => [key, process.env[key]])
  );
}

function loadCommonJs(entryPath, source) {
  const module = { exports: {} };
  const localRequire = createRequire(entryPath);
  const descriptorEnv = createDescriptorEnv();
  const sandbox = {
    module,
    exports: module.exports,
    require: localRequire,
    __filename: entryPath,
    __dirname: path.dirname(entryPath),
    process: {
      env: descriptorEnv,
      cwd: () => descriptorEnv.WORKING_DIRECTORY || path.dirname(entryPath),
    },
    console: {
      log: (...args) => process.stderr.write(`[skill] ${args.join(' ')}\n`),
      info: (...args) => process.stderr.write(`[skill] ${args.join(' ')}\n`),
      warn: (...args) => process.stderr.write(`[skill:WARN] ${args.join(' ')}\n`),
      error: (...args) => process.stderr.write(`[skill:ERROR] ${args.join(' ')}\n`),
    },
    Buffer,
    URL,
    URLSearchParams,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
  };

  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, {
    filename: entryPath,
    timeout: 10000,
    displayErrors: true,
  });

  return module.exports;
}

async function loadModule(entryPath) {
  const source = fs.readFileSync(entryPath, 'utf8');
  const looksCommonJs = /\bmodule\.exports\b|\bexports\.[A-Za-z_$]/.test(source);

  if (looksCommonJs) {
    return loadCommonJs(entryPath, source);
  }

  const moduleUrl = `${pathToFileURL(entryPath).href}?descriptor=${Date.now()}`;
  const imported = await import(moduleUrl);
  return imported.default || imported;
}

async function main() {
  if (!skillRootArg || !entrypointArg) {
    throw new Error('Usage: node skill-descriptor-worker.js <skill-root> <entrypoint>');
  }

  const skillRoot = path.resolve(skillRootArg);
  const entryPath = assertContainedPath(skillRoot, path.join(skillRoot, entrypointArg));

  if (!fs.existsSync(entryPath)) {
    throw new Error(`Entrypoint not found: ${entryPath}`);
  }

  const skillModule = await loadModule(entryPath);
  const getDefinition = skillModule?.getSkillDefinition;
  const getTools = skillModule?.getTools;

  if (typeof getDefinition === 'function') {
    const descriptor = await getDefinition();
    process.stdout.write(JSON.stringify(descriptor));
    return;
  }

  if (typeof getTools === 'function') {
    const tools = await getTools();
    process.stdout.write(JSON.stringify({
      schema_version: 0,
      legacy_descriptor: true,
      skill: {
        id: path.basename(skillRoot),
        runtime: 'node',
        entrypoint: entrypointArg,
      },
      tools,
    }));
    return;
  }

  throw new Error('Skill entrypoint must export getSkillDefinition() or getTools()');
}

main().catch(error => fail('Failed to load skill descriptor', error));
