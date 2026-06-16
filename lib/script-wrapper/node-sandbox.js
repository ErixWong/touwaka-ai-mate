/**
 * Node.js Script Sandbox Wrapper
 * 
 * Usage: node node-sandbox.js <sandbox_root> <script_path> [args...]
 * 
 * This wrapper:
 * 1. Takes over fs/fs.promises with path restrictions
 * 2. Restricts all file operations to sandbox_root
 * 3. Loads and executes user script
 * 
 * Environment variables (minimal whitelist):
 * - SANDBOX_ROOT: Absolute path to sandbox root
 * - DATA_BASE_PATH: Data directory path
 * - USER_ID: User ID
 * - EXPERT_ID: Expert ID
 * - NODE_ENV: Node environment
 */

import fs from 'fs';
import path from 'path';
import vm from 'vm';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SANDBOX_ROOT = process.env.SANDBOX_ROOT;
const SCRIPT_PATH = process.argv[2];

if (!SANDBOX_ROOT || !SCRIPT_PATH) {
  console.error('Usage: node node-sandbox.js <sandbox_root> <script_path> [args...]');
  console.error('SANDBOX_ROOT must be set via environment variable');
  process.exit(1);
}

const SANDBOX_ROOT_RESOLVED = path.resolve(SANDBOX_ROOT);

if (!fs.existsSync(SANDBOX_ROOT_RESOLVED)) {
  console.error(`Sandbox root does not exist: ${SANDBOX_ROOT_RESOLVED}`);
  process.exit(1);
}

const FS_PATH_METHODS = new Set([
  'readFileSync', 'readFile', 'writeFileSync', 'writeFile',
  'appendFileSync', 'appendFile', 'readdirSync', 'readdir',
  'mkdirSync', 'mkdir', 'rmdirSync', 'rmdir', 'rmSync', 'rm',
  'unlinkSync', 'unlink', 'statSync', 'stat', 'lstatSync', 'lstat',
  'existsSync', 'exists', 'accessSync', 'access',
  'renameSync', 'rename', 'copyFileSync', 'copyFile',
  'openSync', 'open', 'createReadStream', 'createWriteStream',
  'realpathSync', 'realpath', 'readlinkSync', 'readlink',
  'symlinkSync', 'symlink', 'linkSync', 'link',
  'truncateSync', 'truncate', 'mkdtempSync', 'mkdtemp',
]);

const FS_PROMISES_PATH_METHODS = new Set([
  'readFile', 'writeFile', 'appendFile', 'readdir', 'mkdir', 'rmdir', 'rm',
  'stat', 'lstat', 'access', 'open', 'rename', 'copyFile', 'link', 'unlink',
  'symlink', 'readlink', 'truncate', 'mkdtemp',
]);

function resolveSandboxPath(filePath) {
  const pathStr = Buffer.isBuffer(filePath) ? filePath.toString('utf8') : String(filePath);
  
  let resolvedPath = pathStr;
  
  if (pathStr.startsWith('file://')) {
    try {
      resolvedPath = fileURLToPath(pathStr);
    } catch {
      resolvedPath = pathStr;
    }
  }
  
  const absolutePath = path.isAbsolute(resolvedPath)
    ? path.resolve(resolvedPath)
    : path.resolve(SANDBOX_ROOT_RESOLVED, resolvedPath);
  
  const normalizedRoot = path.resolve(SANDBOX_ROOT_RESOLVED).toLowerCase();
  const normalizedPath = path.resolve(absolutePath).toLowerCase();
  
  if (!normalizedPath.startsWith(normalizedRoot + path.sep.toLowerCase()) &&
      normalizedPath !== normalizedRoot) {
    throw new Error(
      `Path not allowed in sandbox: ${absolutePath}\n` +
      `Sandbox root: ${normalizedRoot}`
    );
  }
  
  return absolutePath;
}

function createRestrictedFsPromises(originalPromises) {
  return new Proxy(originalPromises, {
    get(target, prop) {
      const originalValue = target[prop];
      
      if (FS_PROMISES_PATH_METHODS.has(prop) && typeof originalValue === 'function') {
        return function(...args) {
          if (args.length > 0 && args[0] !== undefined && args[0] !== null) {
            args[0] = resolveSandboxPath(args[0]);
          }
          
          if (['rename', 'copyFile', 'link'].includes(prop) && args.length > 1) {
            args[1] = resolveSandboxPath(args[1]);
          }
          
          return originalValue.apply(target, args);
        };
      }
      
      return originalValue;
    }
  });
}

function createRestrictedFs() {
  return new Proxy(fs, {
    get(target, prop) {
      if (prop === 'promises') {
        return createRestrictedFsPromises(target.promises);
      }
      
      const originalValue = target[prop];
      
      if (FS_PATH_METHODS.has(prop) && typeof originalValue === 'function') {
        return function(...args) {
          if (args.length > 0 && args[0] !== undefined && args[0] !== null) {
            args[0] = resolveSandboxPath(args[0]);
          }
          
          if (['rename', 'renameSync', 'copyFile', 'copyFileSync', 'link', 'linkSync'].includes(prop) && args.length > 1) {
            args[1] = resolveSandboxPath(args[1]);
          }
          
          return originalValue.apply(target, args);
        };
      }
      
      return originalValue;
    }
  });
}

const scriptArgs = process.argv.slice(3);
const scriptFullPath = path.resolve(SANDBOX_ROOT_RESOLVED, SCRIPT_PATH);

if (!scriptFullPath.startsWith(SANDBOX_ROOT_RESOLVED + path.sep) &&
    scriptFullPath !== SANDBOX_ROOT_RESOLVED) {
  console.error(`Script path must be within sandbox: ${SCRIPT_PATH}`);
  process.exit(1);
}

if (!fs.existsSync(scriptFullPath)) {
  console.error(`Script file not found: ${SCRIPT_PATH}`);
  process.exit(1);
}

const ext = path.extname(scriptFullPath).toLowerCase();
if (!['.js', '.mjs', '.cjs'].includes(ext)) {
  console.error(`Script must be .js, .mjs, or .cjs: ${SCRIPT_PATH}`);
  process.exit(1);
}

const userRequire = createRequire(scriptFullPath);

const safeRequire = (moduleName) => {
  if (moduleName.startsWith('./') || moduleName.startsWith('../')) {
    const resolved = userRequire.resolve(path.resolve(SANDBOX_ROOT_RESOLVED, moduleName));
    if (!resolved.startsWith(SANDBOX_ROOT_RESOLVED + path.sep)) {
      throw new Error(`Relative import not allowed outside sandbox: ${moduleName}`);
    }
    return userRequire(moduleName);
  }
  
  const builtinModules = [
    'fs', 'path', 'url', 'crypto', 'util', 'stream', 'buffer', 'events',
    'os', 'zlib', 'http', 'https', 'querystring', 'string_decoder',
    'console', 'module', 'timers', 'assert', 'constants',
  ];
  
  if (builtinModules.includes(moduleName)) {
    if (moduleName === 'fs') {
      return createRestrictedFs();
    }
    return userRequire(moduleName);
  }
  
  throw new Error(`Module '${moduleName}' is not allowed in sandbox`);
};

const restrictedProcess = {
  env: {
    NODE_ENV: process.env.NODE_ENV || 'development',
    DATA_BASE_PATH: process.env.DATA_BASE_PATH || '',
    USER_ID: process.env.USER_ID || '',
    EXPERT_ID: process.env.EXPERT_ID || '',
    SANDBOX_ROOT: SANDBOX_ROOT_RESOLVED,
  },
  cwd: () => SANDBOX_ROOT_RESOLVED,
  argv: ['node', scriptFullPath, ...scriptArgs],
  exit: (code) => process.exit(code),
  version: process.version,
  platform: process.platform,
  arch: process.arch,
};

const sandboxContext = {
  require: safeRequire,
  console: {
    log: (...args) => process.stdout.write(args.map(a => String(a)).join(' ') + '\n'),
    error: (...args) => process.stderr.write(args.map(a => String(a)).join(' ') + '\n'),
    warn: (...args) => process.stderr.write('[WARN] ' + args.map(a => String(a)).join(' ') + '\n'),
    info: (...args) => process.stdout.write('[INFO] ' + args.map(a => String(a)).join(' ') + '\n'),
  },
  process: restrictedProcess,
  Buffer: Buffer,
  URL: URL,
  URLSearchParams: URLSearchParams,
  setTimeout: setTimeout,
  clearTimeout: clearTimeout,
  setInterval: setInterval,
  clearInterval: clearInterval,
  __filename: scriptFullPath,
  __dirname: path.dirname(scriptFullPath),
  module: { exports: {} },
  exports: {},
};

vm.createContext(sandboxContext);

const scriptCode = fs.readFileSync(scriptFullPath, 'utf-8');

const wrappedCode = `
(function() {
  ${scriptCode}
})();
`;

try {
  vm.runInContext(wrappedCode, sandboxContext, {
    timeout: 30000,
    displayErrors: true,
  });
  
  process.exit(0);
} catch (error) {
  process.stderr.write(`Script execution failed: ${error.message}\n`);
  if (error.stack) {
    process.stderr.write(`Stack: ${error.stack}\n`);
  }
  process.exit(1);
}