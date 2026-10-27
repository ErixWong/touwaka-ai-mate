#!/usr/bin/env node
/**
 * check-unimported-identifiers — 「调用了本文件没导入/没声明的标识符」零依赖守卫
 *
 * 由来（#1219）：
 *   `lib/doc-pipeline-defaults.js` 的 `createCallLlmFn` 里调用了 `parseJsonLikeContent`
 *   和 `logger`，两个符号**都没有 import**。这条路径一旦执行就是
 *   `ReferenceError: parseJsonLikeContent is not defined`。
 *   该状态从 `f9f6bdb`（2026-07-05）活到 #1219，因为 `npm run lint` 里没有任何检查会抓它
 *   （仓里没有 eslint，也没有 eslint 配置文件）。
 *
 * 判定口径：
 *   对一个 JS 源文件，扫描所有**被引用的标识符**（调用 `f(...)`、`new F(...)`、成员基座 `obj.x`、
 *   对象字面量简写 `{ x }`、`export { x }` 清单，以及赋值/返回/条件里的裸标识符），
 *   要求每个标识符满足三者之一：
 *     1. 本文件 import 进来的名字（default / named / namespace）
 *     2. 本文件任意作用域的本地声明（function / class / const / let / var / 参数 / catch / 箭头函数参数 / 解构绑定）
 *     3. GLOBAL_WHITELIST 里的 ECMAScript / Node / Web 标准全局
 *   否则报「未声明标识符」并以非零退出码失败。
 *
 * 这是**启发式**，不是类型检查、不是完备静态分析。覆盖面与已知漏报见文件末尾 KNOWN LIMITS。
 *
 * 用法：
 *   node scripts/check-unimported-identifiers.js                # 扫默认目录
 *   node scripts/check-unimported-identifiers.js <file|dir> ... # 扫指定路径
 *   node scripts/check-unimported-identifiers.js --self-test     # 只跑内置红绿 fixture
 *   node scripts/check-unimported-identifiers.js --no-self-test   # 跳过 fixture（不建议）
 *
 * 退出码：0 = 通过；1 = 发现问题（或 fixture 自证失败）；2 = 用法/IO 错误。
 */

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, extname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------------------
// 扫描范围
// ---------------------------------------------------------------------------

/** 默认扫描的顶层目录（相对仓库根）。frontend/ 不在此列，理由见 KNOWN LIMITS。 */
const DEFAULT_TARGETS = ['lib', 'server', 'scripts', 'apps', 'tests'];

const SCAN_EXTS = new Set(['.js', '.mjs', '.cjs']);

/** 目录/文件级排除（相对路径片段匹配）。 */
const EXCLUDE_SEGMENTS = ['node_modules', '.git', 'dist', 'build', 'coverage'];

// ---------------------------------------------------------------------------
// 全局白名单
// ---------------------------------------------------------------------------

/**
 * 允许「不 import 直接用」的标准全局。
 * 口径：只收 ECMAScript 语言内建 + Node.js 全局 + 浏览器/Web 标准全局。
 * **不收**任何本项目自己的符号（项目符号必须显式 import，这正是本守卫要保证的）。
 */
const GLOBAL_WHITELIST = new Set([
  // --- ECMAScript 语言内建 ---
  'globalThis', 'undefined', 'NaN', 'Infinity',
  'Object', 'Function', 'Boolean', 'Symbol', 'Number', 'BigInt', 'Math', 'Date',
  'String', 'RegExp', 'Array', 'Promise', 'Proxy', 'Reflect', 'JSON', 'Intl',
  'Map', 'Set', 'WeakMap', 'WeakSet', 'WeakRef', 'FinalizationRegistry',
  'ArrayBuffer', 'SharedArrayBuffer', 'DataView', 'Atomics',
  'Int8Array', 'Uint8Array', 'Uint8ClampedArray', 'Int16Array', 'Uint16Array',
  'Int32Array', 'Uint32Array', 'Float32Array', 'Float64Array',
  'BigInt64Array', 'BigUint64Array',
  'Error', 'EvalError', 'RangeError', 'ReferenceError', 'SyntaxError',
  'TypeError', 'URIError', 'AggregateError',
  'eval', 'isFinite', 'isNaN', 'parseFloat', 'parseInt',
  'decodeURI', 'decodeURIComponent', 'encodeURI', 'encodeURIComponent',
  'escape', 'unescape',
  'Iterator',
  // --- Node.js 全局 ---
  'process', 'Buffer', 'console', 'global',
  'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval',
  'setImmediate', 'clearImmediate', 'queueMicrotask',
  '__dirname', '__filename', 'module', 'exports', 'require',
  'structuredClone', 'performance', 'crypto',
  // --- Web / Fetch 标准全局（Node 18+ 内建） ---
  'URL', 'URLSearchParams', 'fetch', 'FormData', 'Headers', 'Request', 'Response',
  'AbortController', 'AbortSignal', 'Blob', 'File', 'FileReader', 'TextEncoder',
  'TextDecoder', 'ReadableStream', 'WritableStream', 'TransformStream',
  'WebSocket', 'Event', 'EventTarget', 'CustomEvent', 'MessageChannel',
  'MessagePort', 'BroadcastChannel', 'atob', 'btoa', 'navigator',
  'localStorage', 'sessionStorage', 'document', 'window', 'self', 'location',
  'history', 'alert', 'confirm', 'prompt', 'Worker', 'Image', 'Audio',
  'WebAssembly', 'reportError',
]);

/**
 * 测试文件里额外允许的全局（mocha / node:test 注入的 BDD 风格函数）。
 * **仅对测试文件生效**，不污染业务代码的检查强度。
 */
const TEST_GLOBALS = new Set([
  'describe', 'it', 'context', 'specify', 'suite', 'test', 'xdescribe', 'xit',
  'before', 'after', 'beforeEach', 'afterEach',
]);

/** 判定一个文件是否「测试文件」。 */
function isTestFile(absPath) {
  const p = absPath.split(sep).join('/');
  return /\/(tests?|__tests__)\//.test(p) || /\.(test|spec)\.[cm]?js$/.test(p);
}

/** 语法关键字：永远不作为「被引用标识符」检查。 */
const KEYWORDS = new Set([
  'break', 'case', 'catch', 'class', 'const', 'continue', 'debugger', 'default',
  'delete', 'do', 'else', 'enum', 'export', 'extends', 'false', 'finally',
  'for', 'function', 'if', 'import', 'in', 'instanceof', 'new', 'null',
  'return', 'super', 'switch', 'this', 'throw', 'true', 'try', 'typeof', 'var',
  'void', 'while', 'with', 'yield', 'let', 'static', 'await', 'async',
  'implements', 'interface', 'package', 'private', 'protected', 'public',
  'arguments',
]);

/** 上下文关键字：作为「修饰符/运算符」出现时不算引用（`of`/`get`/`set`/`as`/`from`）。 */
const CONTEXTUAL = new Set(['of', 'get', 'set', 'as', 'from']);

/** 出现在这些 token 之后，标识符处于「表达式起始」位置（可接正则字面量）。 */
const REGEX_PREFIX_KEYWORDS = new Set([
  'return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void',
  'throw', 'case', 'do', 'else', 'yield', 'await',
]);

// ---------------------------------------------------------------------------
// 词法分析（tokenizer）
// ---------------------------------------------------------------------------

const PUNCTUATORS = [
  '>>>=', '...', '===', '!==', '**=', '<<=', '>>=', '>>>', '&&=', '||=', '??=',
  '=>', '==', '!=', '<=', '>=', '&&', '||', '??', '?.', '++', '--',
  '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '<<', '>>', '**',
  '{', '}', '(', ')', '[', ']', ';', ',', '<', '>', '+', '-', '*', '/', '%',
  '&', '|', '^', '!', '~', '?', ':', '=', '.', '@', '#', '${',
].sort((a, b) => b.length - a.length);

const ID_START = /[A-Za-z_$\u0080-\uffff]/;
const ID_PART = /[A-Za-z0-9_$\u0080-\uffff]/;

/**
 * 把源码切成 token 数组。
 * token: { type: 'ident'|'punct'|'num'|'str'|'tmpl'|'regex'|'private', value, line, col }
 * 注释不产出 token（但仍推进行号）。
 */
function tokenize(src) {
  const toks = [];
  let i = 0;
  let line = 1;
  let lineStart = 0;
  const n = src.length;
  // 模板字面量栈：{ kind: 'template' } | { kind: 'templateExpr', depth }
  const tmplStack = [];

  const push = (type, value, tokLine, tokCol) => {
    toks.push({ type, value, line: tokLine, col: tokCol });
  };
  const lastSig = () => (toks.length ? toks[toks.length - 1] : null);
  const inTemplateExpr = () => {
    for (let k = tmplStack.length - 1; k >= 0; k--) {
      if (tmplStack[k].kind === 'templateExpr') return tmplStack[k];
      return null; // 最内层是 template 文本态 ⇒ 不在表达式里
    }
    return null;
  };

  const regexAllowed = () => {
    const p = lastSig();
    if (!p) return true;
    if (p.type === 'num' || p.type === 'str' || p.type === 'regex' || p.type === 'tmpl') return false;
    if (p.type === 'ident') return REGEX_PREFIX_KEYWORDS.has(p.value);
    if (p.type === 'punct') {
      if (p.value === ')' || p.value === ']' || p.value === '}') return false;
      if (p.value === '++' || p.value === '--') return false;
      return true;
    }
    return true;
  };

  // shebang（`#!/usr/bin/env node`）不是代码
  if (src.startsWith('#!')) {
    while (i < n && src[i] !== '\n') i++;
  }

  while (i < n) {
    const c = src[i];
    const col = i - lineStart + 1;

    // 模板文本态
    if (tmplStack.length && tmplStack[tmplStack.length - 1].kind === 'template') {
      if (c === '\\') { i += 2; continue; }
      if (c === '\n') { line++; lineStart = i + 1; i++; continue; }
      if (c === '`') { tmplStack.pop(); i++; continue; }
      if (c === '$' && src[i + 1] === '{') {
        i += 2;
        push('punct', '${', line, col);
        tmplStack.push({ kind: 'templateExpr', depth: 0 });
        continue;
      }
      i++;
      continue;
    }

    // 空白
    if (c === '\n') { line++; lineStart = i + 1; i++; continue; }
    if (c === ' ' || c === '\t' || c === '\r' || c === '\f' || c === '\v' || c === '\u00a0' || c === '\ufeff') { i++; continue; }

    // 注释
    if (c === '/' && src[i + 1] === '/') {
      while (i < n && src[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && src[i + 1] === '*') {
      i += 2;
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) {
        if (src[i] === '\n') { line++; lineStart = i + 1; }
        i++;
      }
      i += 2;
      continue;
    }

    // 字符串
    if (c === '\'' || c === '"') {
      const quote = c;
      const startLine = line;
      const startCol = col;
      i++;
      let buf = '';
      while (i < n) {
        const d = src[i];
        if (d === '\\') { buf += src[i + 1] ?? ''; i += 2; continue; }
        if (d === '\n') { line++; lineStart = i + 1; }
        if (d === quote) { i++; break; }
        buf += d;
        i++;
      }
      push('str', buf, startLine, startCol);
      continue;
    }

    // 模板起始
    if (c === '`') { i++; tmplStack.push({ kind: 'template' }); continue; }

    // 正则字面量
    if (c === '/' && regexAllowed()) {
      const startLine = line;
      const startCol = col;
      i++;
      let inClass = false;
      while (i < n) {
        const d = src[i];
        if (d === '\\') { i += 2; continue; }
        if (d === '\n') break;
        if (d === '[') inClass = true;
        else if (d === ']') inClass = false;
        else if (d === '/' && !inClass) { i++; break; }
        i++;
      }
      while (i < n && ID_PART.test(src[i])) i++; // flags
      push('regex', '/regex/', startLine, startCol);
      continue;
    }

    // 数字
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] ?? ''))) {
      const start = i;
      if (c === '0' && /[xXbBoO]/.test(src[i + 1] ?? '')) {
        i += 2;
        while (i < n && /[0-9a-fA-F_]/.test(src[i])) i++;
      } else {
        while (i < n && /[0-9_]/.test(src[i])) i++;
        if (src[i] === '.') { i++; while (i < n && /[0-9_]/.test(src[i])) i++; }
        if (/[eE]/.test(src[i] ?? '')) {
          i++;
          if (/[+-]/.test(src[i] ?? '')) i++;
          while (i < n && /[0-9_]/.test(src[i])) i++;
        }
      }
      if (src[i] === 'n') i++;
      push('num', src.slice(start, i), line, col);
      continue;
    }

    // 私有字段 #name
    if (c === '#' && ID_START.test(src[i + 1] ?? '')) {
      const start = i;
      i++;
      while (i < n && ID_PART.test(src[i])) i++;
      push('private', src.slice(start, i), line, col);
      continue;
    }

    // 标识符
    if (ID_START.test(c)) {
      const start = i;
      while (i < n && ID_PART.test(src[i])) i++;
      push('ident', src.slice(start, i), line, col);
      continue;
    }

    // 标点
    let matched = null;
    for (const p of PUNCTUATORS) {
      if (src.startsWith(p, i)) { matched = p; break; }
    }
    if (matched) {
      // 模板表达式里的 } 收口
      if (matched === '}' || matched === '{') {
        const top = tmplStack.length ? tmplStack[tmplStack.length - 1] : null;
        if (matched === '}' && top && top.kind === 'templateExpr' && top.depth === 0) {
          tmplStack.pop();
          // 仍然产出 `}` token，让 `${` 与它成对（否则帧栈不平衡）
          push('punct', '}', line, col);
          i++;
          continue;
        }
        if (matched === '{' && top && top.kind === 'templateExpr') top.depth++;
        if (matched === '}' && top && top.kind === 'templateExpr') top.depth--;
      }
      push('punct', matched, line, col);
      i += matched.length;
      continue;
    }

    // 无法识别的字符：跳过（不报错，保持守卫对奇怪字符的鲁棒性）
    i++;
  }

  return toks;
}

// ---------------------------------------------------------------------------
// 括号配对表
// ---------------------------------------------------------------------------

function buildMatchMap(toks) {
  const match = new Array(toks.length).fill(-1);
  const stack = [];
  const openers = { '(': ')', '[': ']', '{': '}', '${': '}' };
  const closers = { ')': '(', ']': '[', '}': '{' };
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (t.type !== 'punct') continue;
    if (openers[t.value]) {
      stack.push(i);
    } else if (closers[t.value]) {
      // 找到最近的同类 opener
      for (let k = stack.length - 1; k >= 0; k--) {
        const oi = stack[k];
        const ov = toks[oi].value;
        if ((t.value === '}' && (ov === '{' || ov === '${')) || openers[ov] === t.value) {
          match[oi] = i;
          match[i] = oi;
          stack.length = k;
          break;
        }
      }
    }
  }
  return match;
}

// ---------------------------------------------------------------------------
// 结构分析：声明集合 + 引用候选
// ---------------------------------------------------------------------------

/**
 * @param {Array} toks
 * @returns {{ declared: Set<string>, candidates: Array<{name:string,line:number,col:number,kind:string}> }}
 */
function analyzeTokens(toks) {
  const match = buildMatchMap(toks);
  const declared = new Set();
  const candidates = [];

  // 帧栈
  // { kind: 'block'|'object'|'class'|'paren'|'bracket'|'params'|'template', expectKey, inDefault }
  const frames = [];
  const topFrame = () => (frames.length ? frames[frames.length - 1] : null);

  const isPunct = (i, v) => i >= 0 && i < toks.length && toks[i].type === 'punct' && toks[i].value === v;

  /** 判断 `{` 是对象字面量 / 类体 / 语句块。 */
  function classifyBrace(prev) {
    if (!prev) return 'block';
    if (prev.type === 'punct') {
      if (prev.value === ')' || prev.value === ']' || prev.value === '}') return 'block';
      if (prev.value === '=>') return 'block';
      if (prev.value === ';') return 'block';
      if (prev.value === '{') return 'block';
      if (prev.value === ':') return 'object'; // `{ a: { ... } }` 或 case 里的对象
      if (prev.value === '${') return 'block';
      return 'object'; // ( , = [ ? && || ! + - * / % ... 等 ⇒ 表达式位置
    }
    if (prev.type === 'ident') {
      if (prev.value === 'class') return 'class';
      if (prev.value === 'extends') return 'class';
      if (prev.value === 'else' || prev.value === 'try' || prev.value === 'finally' || prev.value === 'do') return 'block';
      if (prev.value === 'return') return 'object'; // return { ... }
      if (prev.value === 'static') return 'block'; // static { ... }
      if (prev.value === 'default') return 'object'; // export default { ... }
      // `class A extends B {` 已被 extends 分支处理；其余标识符后跟 { 视为 block（`if (x) {`、`foo() {` 不会到这）
      return 'block';
    }
    return 'block';
  }

  /**
   * 判断 `(` 是函数参数表（而不是普通调用/分组括号）。
   * 只在能确认时返回 true；误判为 params 的代价是「该括号内的标识符被当成声明」（漏报），
   * 误判为 paren 的代价是「解构参数被当成对象字面量」（误报）——所以这里宁宽勿窄。
   */
  function isParamList(i, prev) {
    const close = match[i];
    if (close >= 0) {
      const after = toks[close + 1];
      if (after && after.type === 'punct' && after.value === '=>') return true;
    }
    if (!prev) return false;
    if (prev.type === 'private') return true; // `#method(` 私有方法定义
    if (prev.type === 'ident') {
      if (prev.value === 'function' || prev.value === 'catch') return true;
      if (prev.value === 'constructor') return true;
      if (KEYWORDS.has(prev.value)) return false;
      const p2 = toks[i - 2];
      if (p2) {
        if (p2.type === 'ident') {
          if (p2.value === 'function' || p2.value === 'async' || p2.value === 'static'
            || p2.value === 'get' || p2.value === 'set') return true;
        } else if (p2.type === 'punct') {
          // `{` `}` `;` `,` `*` 之后紧跟 `name(` ⇒ 方法定义（对象字面量/类体里）
          if (p2.value === '{' || p2.value === '}' || p2.value === ';'
            || p2.value === ',' || p2.value === '*' || p2.value === '${') return true;
        }
      }
      return false;
    }
    if (prev.type === 'punct') {
      if (prev.value === 'function') return true;
      if (prev.value === '*') {
        const p2 = toks[i - 2];
        if (p2 && p2.type === 'ident' && p2.value === 'function') return true;
        return false;
      }
    }
    return false;
  }

  // `class` 之后第一个同层的 `{` 是类体（`class A extends mixin(B) {` 也覆盖）
  let pendingClassDepth = -1;

  let i = 0;
  while (i < toks.length) {
    const t = toks[i];
    const prev = toks[i - 1] ?? null;
    const frame = topFrame();

    if (t.type === 'punct') {
      const v = t.value;
      if (v === '(') {
        const params = isParamList(i, prev);
        frames.push({ kind: params ? 'params' : 'paren', expectKey: false, inDefault: false });
        // 具名函数声明：`function name(` —— name 在上一轮已作为声明记录
        i++;
        continue;
      }
      if (v === '[') {
        const pattern = !!frame && (frame.kind === 'params' || frame.kind === 'pattern') && !frame.inDefault;
        frames.push({ kind: pattern ? 'pattern' : 'bracket', expectKey: false, inDefault: false });
        i++;
        continue;
      }
      if (v === '{' || v === '${') {
        let kind = v === '${' ? 'block' : classifyBrace(prev);
        if (pendingClassDepth === frames.length) {
          kind = 'class';
          pendingClassDepth = -1;
        }
        if (v === '{' && frame && (frame.kind === 'params' || frame.kind === 'pattern') && !frame.inDefault) {
          kind = 'pattern'; // 参数表/嵌套模式里的 `{` 是解构模式，不是对象字面量
        }
        if (v === '{' && prev && prev.type === 'ident'
          && (prev.value === 'const' || prev.value === 'let' || prev.value === 'var')) {
          kind = 'pattern'; // const/let/var 解构模式
        }
        frames.push({ kind, expectKey: kind === 'object', inDefault: false });
        i++;
        continue;
      }
      if (v === ')' || v === ']' || v === '}') {
        frames.pop();
        i++;
        continue;
      }
      if (v === ',') {
        if (frame) {
          if (frame.kind === 'object') frame.expectKey = true;
          if (frame.kind === 'params' || frame.kind === 'paren' || frame.kind === 'pattern') frame.inDefault = false;
        }
        i++;
        continue;
      }
      if (v === '=') {
        if (frame && (frame.kind === 'params' || frame.kind === 'paren' || frame.kind === 'pattern')) frame.inDefault = true;
        if (frame && frame.kind === 'object') frame.expectKey = false;
        i++;
        continue;
      }
      if (v === ';') {
        if (frame && frame.kind === 'object') frame.expectKey = true;
        i++;
        continue;
      }
      i++;
      continue;
    }

    if (t.type !== 'ident') { i++; continue; }

    const name = t.value;

    // --- import 语句：整段收集为声明 ---
    if (name === 'import' && !(prev && prev.type === 'punct' && (prev.value === '.' || prev.value === '?.'))) {
      // import.meta 不是 import 语句
      if (isPunct(i + 1, '.') || isPunct(i + 1, '(')) { i++; continue; }
      let j = i + 1;
      // import 'x'
      if (toks[j] && toks[j].type === 'str') { i = j + 1; continue; }
      while (j < toks.length) {
        const u = toks[j];
        if (u.type === 'punct' && u.value === ';') { j++; break; }
        if (u.type === 'ident' && u.value === 'from') { j++; break; }
        if (u.type === 'punct' && u.value === '{') {
          const close = match[j];
          if (close < 0) { j++; continue; }
          for (let k = j + 1; k < close; k++) {
            const s = toks[k];
            if (s.type !== 'ident') continue;
            if (s.value === 'as') continue;
            declared.add(s.value); // imported 名与 `as` 后的本地别名都算已声明
          }
          j = close + 1;
          continue;
        }
        if (u.type === 'punct' && u.value === '*') { j++; continue; }
        if (u.type === 'ident' && u.value === 'as') { j++; continue; }
        if (u.type === 'ident') { declared.add(u.value); j++; continue; } // default import
        j++;
      }
      // 跳过模块说明符字符串
      if (toks[j] && toks[j].type === 'str') j++;
      if (isPunct(j, ';')) j++;
      i = j;
      continue;
    }

    // --- export { a, b as c } / export { x } from '...' ---
    if (name === 'export' && isPunct(i + 1, '{')) {
      const close = match[i + 1];
      const afterClose = close >= 0 ? toks[close + 1] : null;
      const reExport = afterClose && afterClose.type === 'ident' && afterClose.value === 'from';
      if (!reExport) {
        // 导出清单里的名字是「对本地声明的引用」
        for (let j = i + 2; j < close; j++) {
          const u = toks[j];
          if (u.type !== 'ident') continue;
          const before = toks[j - 1];
          if (before && before.type === 'ident' && before.value === 'as') continue;
          if (u.value === 'as') continue;
          candidates.push({ name: u.value, line: u.line, col: u.col, kind: 'export-specifier' });
        }
      }
      i = (close >= 0 ? close + 1 : i + 1);
      continue;
    }

    // --- 声明名位置 ---
    if (prev && prev.type === 'ident' && (prev.value === 'function' || prev.value === 'class')) {
      declared.add(name);
      i++;
      continue;
    }
    // 匿名 class 表达式 `const C = class { ... }` / `export default class { ... }`
    if (name === 'class') pendingClassDepth = frames.length;
    if (prev && prev.type === 'punct' && prev.value === '*' && toks[i - 2] && toks[i - 2].type === 'ident' && toks[i - 2].value === 'function') {
      declared.add(name); // function* name
      i++;
      continue;
    }

    // --- const/let/var 绑定 ---
    if (name === 'const' || name === 'let' || name === 'var') {
      const nx = toks[i + 1];
      if (nx && nx.type === 'punct' && (nx.value === '{' || nx.value === '[')) {
        const close = match[i + 1];
        if (close > 0) {
          for (let j = i + 2; j < close; j++) {
            const u = toks[j];
            if (u.type !== 'ident' || KEYWORDS.has(u.value)) continue;
            if (u.value === 'as') continue;
            if (isPunct(j + 1, ':')) continue; // 对象模式里的 key
            declared.add(u.value);
          }
        }
        i++;
        continue;
      }
      // `const NAME`：下一个 ident 是声明名（由下面的 prev 分支记录）
      i++;
      continue;
    }
    if (prev && prev.type === 'ident' && (prev.value === 'const' || prev.value === 'let' || prev.value === 'var')) {
      if (isPunct(i + 1, '{') || isPunct(i + 1, '[')) {
        const close = match[i + 1];
        if (close >= 0) {
          for (let j = i + 2; j < close; j++) {
            if (toks[j].type === 'ident' && !KEYWORDS.has(toks[j].value)) {
              // 跳过 `key: value` 里的 key（其下一个 token 是 ':'）
              if (isPunct(j + 1, ':')) continue;
              if (toks[j].value === 'as') continue;
              declared.add(toks[j].value);
            }
          }
        }
        i++;
        continue;
      }
      declared.add(name);
      i++;
      continue;
    }

    // --- 函数参数表 / 解构模式内 ---
    if (frame && (frame.kind === 'params' || frame.kind === 'pattern')) {
      if (frame.inDefault) {
        // 默认值是引用表达式：只做引用检查（属性访问、私有字段不查）
        const pv = toks[i - 1];
        const isProp = pv && pv.type === 'punct' && (pv.value === '.' || pv.value === '?.');
        if (!isProp && (isPunct(i + 1, '(') || isPunct(i + 1, '.'))) pushCandidate(name, t, 'default-value');
        i++;
        continue;
      }
      if (isPunct(i + 1, ':')) { i++; continue; } // 对象模式 key（值侧才是绑定）
      declared.add(name);
      i++;
      continue;
    }

    // --- catch (e) ---
    if (prev && prev.type === 'punct' && prev.value === '(' && toks[i - 2] && toks[i - 2].type === 'ident' && toks[i - 2].value === 'catch') {
      declared.add(name);
      i++;
      continue;
    }

    // --- 单参箭头函数 `x => ...` ---
    if (isPunct(i + 1, '=>')) {
      declared.add(name);
      i++;
      continue;
    }

    // --- 关键字 / 上下文关键字 ---
    if (KEYWORDS.has(name)) { i++; continue; }
    if (CONTEXTUAL.has(name)) { i++; continue; }

    // --- 属性访问 `.name` / `?.name` / `#name` ---
    if (prev && prev.type === 'punct' && (prev.value === '.' || prev.value === '?.')) { i++; continue; }
    if (prev && prev.type === 'private') { i++; continue; }

    // --- typeof x：`typeof undeclared` 是合法写法 ---
    if (prev && prev.type === 'ident' && prev.value === 'typeof') { i++; continue; }

    // --- 对象字面量 / 类体 key 位置 ---
    if (frame && frame.kind === 'object' && frame.expectKey) {
      if (isPunct(i + 1, ':') || isPunct(i + 1, '(')) { i++; continue; } // key / method shorthand
      if (name === 'get' || name === 'set' || name === 'async') { i++; continue; } // 修饰符
      if (isPunct(i + 1, ',') || isPunct(i + 1, '}')) { pushCandidate(name, t, 'shorthand'); i++; continue; } // `{ foo }` 简写是引用
    }
    if (frame && frame.kind === 'class') {
      // 类体成员：`foo(` / `foo =` / `foo;` / `static foo` / `get foo` / `#foo`
      if (isPunct(i + 1, '(') || isPunct(i + 1, '=') || isPunct(i + 1, ';') || isPunct(i + 1, '}')) { i++; continue; }
      if (name === 'static' || name === 'get' || name === 'set' || name === 'async') { i++; continue; }
    }

    // --- 方法定义的参数表前那个名字（`name(` 且下一 token 后紧跟 `{`）---
    if (isPunct(i + 1, '(')) {
      const close = match[i + 1];
      const after = close >= 0 ? toks[close + 1] : null;
      const isMethodDef = after && after.type === 'punct' && after.value === '{'
        && (!prev || (prev.type === 'punct' && (prev.value === '{' || prev.value === '}' || prev.value === ';' || prev.value === ',')));
      if (isMethodDef) { i++; continue; }
      pushCandidate(name, t, 'call');
      i++;
      continue;
    }

    // --- new X ---
    if (prev && prev.type === 'ident' && prev.value === 'new') {
      pushCandidate(name, t, 'construct');
      i++;
      continue;
    }

    // --- 成员访问基座 `X.foo` ---
    if (isPunct(i + 1, '.') || isPunct(i + 1, '?.')) {
      pushCandidate(name, t, 'member-base');
      i++;
      continue;
    }

    pushCandidate(name, t, 'bare-ref');
    i++;
  }

  function pushCandidate(name, tok, kind) {
    if (KEYWORDS.has(name)) return;
    candidates.push({ name, line: tok.line, col: tok.col, kind });
  }

  return { declared, candidates };
}

// ---------------------------------------------------------------------------
// 单文件检查
// ---------------------------------------------------------------------------

/**
 * @returns {Array<{line:number,col:number,name:string,kind:string}>} 问题列表
 */
export function checkSource(src, { ignoreGlobals = false, extraGlobals = null } = {}) {
  const toks = tokenize(src);
  const { declared, candidates } = analyzeTokens(toks);
  const problems = [];
  const seen = new Set();
  for (const c of candidates) {
    if (declared.has(c.name)) continue;
    if (!ignoreGlobals && GLOBAL_WHITELIST.has(c.name)) continue;
    if (extraGlobals && extraGlobals.has(c.name)) continue;
    if (c.name === 'undefined' || c.name === 'NaN' || c.name === 'Infinity') continue;
    const key = `${c.line}:${c.col}:${c.name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    problems.push(c);
  }
  return problems;
}

export function checkFile(absPath) {
  const src = readFileSync(absPath, 'utf8');
  const extraGlobals = isTestFile(absPath) ? TEST_GLOBALS : null;
  return checkSource(src, { extraGlobals }).map((p) => ({ ...p, file: absPath }));
}

// ---------------------------------------------------------------------------
// 目录遍历
// ---------------------------------------------------------------------------

function isExcluded(p) {
  const segs = p.split(sep);
  return segs.some((s) => EXCLUDE_SEGMENTS.includes(s));
}

function walk(target, out) {
  if (!existsSync(target)) return;
  const st = statSync(target);
  if (st.isFile()) {
    if (SCAN_EXTS.has(extname(target)) && !isExcluded(target)) out.push(target);
    return;
  }
  for (const entry of readdirSync(target, { withFileTypes: true })) {
    const p = join(target, entry.name);
    if (isExcluded(p)) continue;
    if (entry.isDirectory()) walk(p, out);
    else if (entry.isFile() && SCAN_EXTS.has(extname(entry.name))) out.push(p);
  }
}

// ---------------------------------------------------------------------------
// 自证 fixture（红绿必须都对）
// ---------------------------------------------------------------------------

const SELF_TEST_CASES = [
  {
    name: '红：调用了未导入的标识符（#1219 原形）',
    code: `
import { a } from './x.js';
function f(db, content) {
  const parsed = parseJsonLikeContent(content, { logPrefix: 'x' });
  return parsed;
}
export { f };
`,
    expect: ['parseJsonLikeContent'],
  },
  {
    name: '红：成员访问基座未导入（logger）',
    code: `
function f() { logger.info('hi'); }
export { f };
`,
    expect: ['logger'],
  },
  {
    name: '红：new 了未导入的类',
    code: `
function f() { return new FooBar(1); }
export { f };
`,
    expect: ['FooBar'],
  },
  {
    name: '红：export 清单里的名字本地不存在',
    code: `
const a = 1;
export { a, ghostExport };
`,
    expect: ['ghostExport'],
  },
  {
    name: '绿：全部来自 import / 本地声明 / 全局白名单',
    code: `
import { readFileSync } from 'node:fs';
import path from 'node:path';
import * as os from 'node:os';

const LOCAL = 1;
let counter = 0;
const { a, b: renamed, c = 3 } = { a: 1, b: 2, c: 3 };
const [first, second] = [1, 2];

function helper(x, y = LOCAL, { opt = counter } = {}) {
  const inner = (z) => z + x + y + opt;
  try {
    console.log(readFileSync(path.join(os.tmpdir(), 'f')), inner(1), a, renamed, first, second);
  } catch (err) {
    return err;
  }
  return null;
}

class Thing extends Map {
  #priv = 1;
  static s = 2;
  constructor() { super(); }
  get value() { return this.#priv; }
  run() { return helper(1); }
}

const obj = {
  key: 'v',
  method() { return 1; },
  get computed() { return 2; },
  async later() { return 3; },
  arrow: () => 4,
};

const re = /abc\\/def[/]ghi/g;
const tpl = \`x \${helper(2)} y \${obj.key}\`;
const optional = obj?.key ?? 'fallback';
for (const item of [1, 2]) { if (item) continue; }
switch (counter) { case 1: break; default: break; }

export { helper, Thing, obj, re, tpl, optional, LOCAL };
export default function main() { return new Thing(); }
`,
    expect: [],
  },
  {
    name: '绿：typeof 未声明标识符是合法守卫写法',
    code: `
function f() { return typeof window !== 'undefined' && window.x; }
export { f };
`,
    expect: [],
  },
];

/**
 * 跑内置 fixture。返回失败描述数组（空 = 通过）。
 * 每轮还会做「变异」：把一个应该报的用例改成正确的，确认它变绿（防永远红/永远绿）。
 */
export function selfTest() {
  const failures = [];
  for (const tc of SELF_TEST_CASES) {
    const problems = checkSource(tc.code);
    const names = [...new Set(problems.map((p) => p.name))].sort();
    const expected = [...tc.expect].sort();
    if (JSON.stringify(names) !== JSON.stringify(expected)) {
      failures.push(
        `fixture「${tc.name}」期望 ${JSON.stringify(expected)}，实际 ${JSON.stringify(names)}`
      );
    }
  }
  // 反向自证：把 #1219 原形的调用改成本地声明的函数，必须变绿
  const mutated = `
import { a } from './x.js';
const parseJsonLikeContent = () => ({ ok: true });
function f(db, content) { return parseJsonLikeContent(content, { logPrefix: 'x' }); }
export { f };
`;
  const mutatedProblems = checkSource(mutated);
  if (mutatedProblems.length !== 0) {
    failures.push(
      `fixture「变异：补上声明后必须变绿」实际仍报 ${JSON.stringify(mutatedProblems.map((p) => p.name))}`
    );
  }
  return failures;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function main(argv) {
  const args = argv.slice(2);
  const selfTestOnly = args.includes('--self-test');
  const skipSelfTest = args.includes('--no-self-test');
  const targets = args.filter((a) => !a.startsWith('--'));

  if (!skipSelfTest) {
    const failures = selfTest();
    if (failures.length) {
      console.error('❌ check-unimported-identifiers 自证失败（守卫本身坏了）：');
      for (const f of failures) console.error('   - ' + f);
      return 1;
    }
    console.log(`✅ 自证 fixture 通过（${SELF_TEST_CASES.length} 条红绿样例 + 1 条变异）`);
  }
  if (selfTestOnly) return 0;

  const roots = targets.length ? targets : DEFAULT_TARGETS;
  const files = [];
  for (const r of roots) walk(resolve(process.cwd(), r), files);
  files.sort();

  if (!files.length) {
    console.error('❌ check-unimported-identifiers: 没有找到可扫描的文件（检查参数/工作目录）');
    return 2;
  }

  const all = [];
  for (const f of files) {
    let problems;
    try {
      problems = checkFile(f);
    } catch (e) {
      console.error(`⚠️  跳过无法读取的文件 ${f}: ${e.message}`);
      continue;
    }
    for (const p of problems) all.push(p);
  }

  if (all.length) {
    console.error(`\n❌ 发现 ${all.length} 处「未导入/未声明的标识符」（${files.length} 个文件已扫描）：`);
    for (const p of all) {
      console.error(`   ${relative(process.cwd(), p.file)}:${p.line}:${p.col}  ${p.name}  [${p.kind}]`);
    }
    console.error('\n修复方式：import 该符号，或删除/重命名这处调用。不要加到白名单里凑绿。');
    return 1;
  }

  console.log(`✅ 未发现未导入标识符（扫描 ${files.length} 个文件：${roots.join(', ')}）`);
  return 0;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  process.exitCode = main(process.argv);
}

export { GLOBAL_WHITELIST, DEFAULT_TARGETS, TEST_GLOBALS, tokenize, isTestFile };

// ---------------------------------------------------------------------------
// KNOWN LIMITS —— 已知覆盖面与不覆盖范围（诚实声明，别把它当成完备静态分析）
// ---------------------------------------------------------------------------
//
// 【覆盖】
//   - 默认目录：lib/ server/ scripts/ apps/ tests/ 下的 *.js / *.mjs / *.cjs（实测 547 个文件）
//   - 检查的引用位置：调用 `f(...)`、构造 `new F(...)`、成员基座 `obj.x`、对象字面量简写 `{ x }`、
//     `export { x }` 清单、以及**裸引用**（赋值右侧 / 返回值 / 条件里的裸标识符）
//   - 认作「已声明」的来源：import（default / named / as / namespace）、
//     function / class 名、const/let/var 简单绑定与解构绑定、函数与方法参数（含解构参数与私有方法）、
//     catch 参数、箭头函数参数、for-of/for-in 绑定
//   - 全局白名单：ECMAScript 语言内建 + Node.js 全局 + Web/Fetch 标准全局（见 GLOBAL_WHITELIST）；
//     测试文件（路径含 /tests/ 或 *.test.js / *.spec.js）额外放行 mocha 的
//     describe/it/context/before/after/beforeEach/afterEach/suite/specify/test
//
// 【不覆盖 / 会漏报】（启发式代价，接受并记录）
//   1. 运行时字符串动态调用：`globalThis[name]()`、`eval('foo()')`、`new Function(...)`、
//      动态 `import(variable)` 后的解构调用 —— 一律看不见。
//   2. **跨文件**的一致性：只看「本文件是否声明过这个名字」，不校验 import 的具名导出在目标模块里
//      是否真的存在（那是 bundler / 运行时的活）。反向也一样：本文件声明了但没导出，不报。
//   3. 作用域不敏感：同文件任意作用域声明过同名标识符即视为已声明。
//      因此「在 A 函数里声明、在 B 函数里误用」抓不到（但 #1219 这种「全文件都没有」的能抓到）。
//   4. 标签语句 `label: for(...)`、`import()` 里的表达式、装饰器语法（本项目不用）。
//   4b. `typeof x !== 'undefined' && x.foo` 这种「先 typeof 探针再用」的写法：
//      `typeof x` 被放行（合法写法），但同一文件里后面那处 `x.foo` 仍会被报。
//      目前仓内没有这种形态；真出现时**报出来是对的**（那个 x 本来就该显式声明/import）。
//   5. 把「某个 `(` 判成参数表」时会把里面的标识符当成声明 ⇒ 那个括号内的漏报；
//      实测在 547 个文件上不产生误报，但这是判定逻辑的固有取舍。
//   6. 只扫上述目录；**frontend/ 不扫**——它是 TypeScript + Vue SFC，并且 `frontend/package.json`
//      已经有真 ESLint 9（`eslint.config.ts`）+ `vue-tsc --build` 类型检查，
//      「未声明标识符」在那边由类型系统兜住；本项目**后端/脚本侧**才是这个缺口所在
//      （根 `devDependencies` 里没有 eslint，也没有配置文件）。
//
// 【误报现状】
//   在 547 个文件上全量跑，除 #1219 本体的 4 处（logger ×3 + parseJsonLikeContent ×1）外**零误报**。
//   若日后新增误报：优先修判定逻辑（比如补一种声明形态），**不要**把符号塞进 GLOBAL_WHITELIST 凑绿。
