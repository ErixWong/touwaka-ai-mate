/**
 * 静态守卫：控制器里 `attributes: ['col', ...]` 引用的列必须真实存在于 models/ 的生成模型里。
 *
 * 背景（issue #1188）：提交 031e44d「Token 字段重构」把 messages.tokens 拆成
 * prompt_tokens / completion_tokens，但漏改了三处 `attributes: [... 'tokens' ...]`，
 * 于是三条消息读接口从那天起恒 500（ER_BAD_FIELD_ERROR 1054），226 天无人发现。
 *
 * 本测试零数据库依赖：只读源码文本。
 *   1) 从 models/*.js（sequelize-auto 反向生成，只读）解析真实字段集合：
 *      取 `super.init({ ... })` 第一个对象参数里 depth==1 的键；
 *   2) 扫描 server/controllers/**\/*.js 里**纯字符串字面量**的 `attributes: [...]`，
 *      把它归属到同一查询的模型。判据是「包含该 attributes 的**最内层对象字面量**归属哪个调用」
 *      （与它是第几个位置参数无关），认得这几种形态：
 *        a. include 块里更近的 `model: ...`；
 *        b. 所属调用 `this.Message.findAll({...})`，含 options 落在第 2/3 位置参数的
 *           `Document.findByPk(id, { attributes })`（#1193①）；别名支持传递形式
 *           `const Version = this.models.DocVersion`（#1193②）；
 *        c. `this.db.models.<蛇形表名>.findAll|findOne|findByPk|findAndCountAll|count({...})`，
 *           含下标写法 `db.models['<表名>']` —— <表名> 就是 models/<表名>.js 的模型名；
 *      归不到的（`helper(this.db, {...})`、`roleData.getXxx({...})` 关联 getter 等第三方上下文）
 *      不判违规、只留痕，避免拿不准就发红。
 *   3) 出现模型里不存在的列即失败，失败信息含「文件:行 / 模型 / 列」。
 *
 * 自证有牙：除了扫真实源码，还用合成源码断言「塞一个假列必被抓住」（见文件末尾）。
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const controllersDir = path.join(root, 'server', 'controllers');
const modelsDir = path.join(root, 'models');

/**
 * 存量违规白名单：不在本单范围内、也不假装绿。
 * key = `${controllers 相对路径}|${模型}|${列}`，value = 说明。
 * 只有列在下面的才是「已知且被显式豁免」的；其余一律 fail。
 */
const KNOWN_VIOLATIONS = new Map([
  // 本次已删三处（list / listByTopic / get 的 'tokens'）不在名单里 —— 它们已经消失了。
]);

/** 扫描覆盖面下限：防止解析器被改坏后「零匹配 = 全绿」的假绿。 */
const MIN_SCANNED_ATTRIBUTES_LITERALS = 40;

function listFiles(dir, ext) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFiles(full, ext));
    else if (entry.name.endsWith(ext)) out.push(full);
  }
  return out.sort();
}

/** 取 `super.init({...})` 第一个对象参数的 depth==1 键名 */
function extractModelFields(source) {
  const initIdx = source.indexOf('super.init(');
  if (initIdx < 0) return null;
  const braceStart = source.indexOf('{', initIdx);
  if (braceStart < 0) return null;
  let depth = 0;
  let braceEnd = -1;
  for (let i = braceStart; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) { braceEnd = i; break; }
    }
  }
  if (braceEnd < 0) return null;
  const body = source.slice(braceStart + 1, braceEnd);

  const fields = new Set();
  // body 是 `{` 之后的内容，顶层字段就在 depth 1
  let depth2 = 1;
  const tokenRe = /([A-Za-z_$][\w$]*)\s*:|\{|\}|'[^']*'|"[^"]*"|`[^`]*`|\/\/[^\n]*|\/\*[\s\S]*?\*\//g;
  let m;
  while ((m = tokenRe.exec(body))) {
    const tok = m[0];
    if (tok === '{') depth2 += 1;
    else if (tok === '}') depth2 -= 1;
    else if (m[1] && depth2 === 1) fields.add(m[1]);
  }
  return fields;
}

/** models/*.js → Map(模型名, Set(字段))，模型名取自文件名（与 db.getModel('x') 的 x 同源） */
function loadModelFields() {
  const map = new Map();
  for (const file of listFiles(modelsDir, '.js')) {
    const source = fs.readFileSync(file, 'utf8');
    // models/ 下除 *_models.js 这类聚合文件外都是 sequelize-auto 生成的单模型文件；
    // 没有 super.init( 的（如 init-models.js）不是模型，跳过。
    if (!source.includes('super.init(')) continue;
    const fields = extractModelFields(source);
    if (!fields || fields.size === 0) {
      throw new Error(`无法从 ${path.relative(root, file)} 解析出字段集合（解析器或文件形态变了）`);
    }
    map.set(path.basename(file, '.js'), fields);
  }
  if (map.size < 40) {
    throw new Error(`只解析出 ${map.size} 个模型，models/ 形态可能变了`);
  }
  return map;
}

/**
 * 收集控制器里的模型别名：
 *  1) 既有形态：`this.X = db.getModel('m')` / `const X = ctx.db.getModel('m')`；
 *  2) 传递形态：`const X = this.models.Y` / `const X = <已知名>.models.Y`（含 ctx.db.models.Y）；
 *  3) 再传一层裸名：`const X = Y`（Y 已在表里，或 Y 本身就是真实模型名）。
 * 2)/3) 解析出的模型名必须命中 varMap 已有条目或 models/ 里真实存在的模型名/文件名，
 * 命不中就不登记 —— 宁缺勿误报，让它继续留在「无法归属」里留痕。
 * 别名赋值可能在使用点之前或之后，故对候选集做多轮不动点迭代。
 */
function buildVarMap(source, modelFields) {
  const map = new Map();
  const register = (raw, modelName) => {
    if (!raw || !modelName) return;
    const lhs = raw.replace(/^(?:const|let|var)\s+/, '').trim();
    if (!lhs) return;
    map.set(lhs, modelName);
    const short = lhs.replace(/^this\.models\./, '').replace(/^this\./, '');
    if (short) map.set(short, modelName);
  };

  // 1) `= ...getModel('m')`：与既有实现一致，命中即登记（真有其模型与否交给调用方判）
  const getModelRe = /(this\.models\.[\w$]+|this\.[\w$]+|\b(?:const|let|var)\s+[\w$]+)\s*=\s*[^;\n]*?getModel\(\s*['"]([\w$]+)['"]\s*\)/g;
  let m;
  while ((m = getModelRe.exec(source))) register(m[1], m[2]);

  // 2)/3) 行尾形态的 `LHS = 点号链`（右值不许带括号/引号，免得把方法调用误当别名）
  const assignRe = /(this\.models\.[\w$]+|this\.[\w$]+|\b(?:const|let|var)\s+[\w$]+)\s*=\s*([A-Za-z_$][\w$]*(?:\s*\.\s*[\w$]+)*)\s*;?\s*$/gm;
  const assigns = [];
  while ((m = assignRe.exec(source))) {
    const lhs = m[1].replace(/^(?:const|let|var)\s+/, '').trim();
    const rhs = m[2].replace(/\s+/g, '');
    if (lhs && rhs && lhs !== rhs) assigns.push({ lhs, rhs });
  }
  for (let round = 0; round < 4; round += 1) {
    let changed = false;
    for (const { lhs, rhs } of assigns) {
      const modelName = resolveAliasRhs(rhs, map, modelFields);
      if (modelName && map.get(lhs) !== modelName) {
        map.set(lhs, modelName);
        const short = lhs.replace(/^this\.models\./, '').replace(/^this\./, '');
        if (short && !map.has(short)) map.set(short, modelName);
        changed = true;
      }
    }
    if (!changed) break;
  }
  return map;
}

/**
 * 别名右值 → 模型名。只认 `<任意前缀>.models.<名>` 与裸 `<已登记别名 / 真实模型名>`；
 * 解析不出或命不中真实模型 → null（调用方据此不登记）。
 * 先查 varMap（同文件里 `this.models.X = db.getModel('y')` 这种「挂名」优先于文件名猜测），
 * 再退化到 models/ 的真实模型名（含 -/_ 与 camel 归一化）。
 */
function resolveAliasRhs(rhs, map, modelFields) {
  if (!rhs) return null;
  const modelsAccess = /^(?:[\w$.]*\.)?models\.([\w$]+)$/.exec(rhs);
  if (modelsAccess) {
    const name = modelsAccess[1];
    for (const key of [`this.models.${name}`, `models.${name}`, name]) {
      if (map.has(key)) return map.get(key);
    }
    return modelFields ? resolveModelAccessName(name, modelFields) : name;
  }
  if (/^[\w$]+$/.test(rhs)) {
    if (map.has(rhs)) return map.get(rhs);
    return modelFields ? resolveModelAccessName(rhs, modelFields) : null;
  }
  return null;
}

function resolveModelName(expr, varMap) {
  const gm = /getModel\(\s*['"]([\w$]+)['"]\s*\)/.exec(expr);
  if (gm) return gm[1];
  const cand = expr.trim().replace(/[({\[].*$/, '').trim();
  if (!cand) return null;
  if (varMap.has(cand)) return varMap.get(cand);
  const short = cand.replace(/^this\.models\./, '').replace(/^this\./, '');
  if (varMap.has(short)) return varMap.get(short);
  const tail = cand.split('.').pop();
  return varMap.get(tail) || null;
}

/**
 * 把字符串 / 模板串 / 注释 / 正则字面量的**内容**抹成空格：长度不变、下标一一对应、
 * 换行原样保留，故所有行号计算与切片照旧有效。
 * 目的是让括号配对扫描不被 `'a, b'`、`// )`、`/['"]/` 这类字面量里的括号/逗号带偏。
 * 只做词法级跳过，不解析语法；`/` 是除法还是正则字面量按「前一个有效字符」启发式判别。
 */
function maskLiterals(source) {
  const out = source.split('');
  const n = source.length;
  const blank = (from, to) => {
    for (let i = Math.max(0, from); i < Math.min(to, n); i += 1) if (out[i] !== '\n') out[i] = ' ';
  };
  let lastMeaning = '';
  let i = 0;
  while (i < n) {
    const c = source[i];
    if (c === '/' && source[i + 1] === '/') {
      const end = source.indexOf('\n', i);
      blank(i + 2, end < 0 ? n : end);
      i = end < 0 ? n : end;
      continue;
    }
    if (c === '/' && source[i + 1] === '*') {
      const end = source.indexOf('*/', i + 2);
      blank(i + 2, end < 0 ? n : end);
      i = end < 0 ? n : end + 2;
      continue;
    }
    if (c === '/' && !/[)\w$'"]/.test(lastMeaning)) {
      let j = i + 1;
      let inClass = false;
      while (j < n) {
        const d = source[j];
        if (d === '\\') { j += 2; continue; }
        if (d === '\n') break;
        if (d === '[') inClass = true;
        else if (d === ']') inClass = false;
        else if (d === '/' && !inClass) break;
        j += 1;
      }
      blank(i + 1, j);
      i = Math.min(j + 1, n);
      lastMeaning = '/';
      continue;
    }
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < n) {
        if (source[j] === '\\') { j += 2; continue; }
        if (source[j] === c || source[j] === '\n') break;
        j += 1;
      }
      blank(i + 1, j);
      i = Math.min(j + 1, n);
      lastMeaning = c;
      continue;
    }
    if (c === '`') {
      let j = i + 1;
      while (j < n) {
        const d = source[j];
        if (d === '\\') { blank(j, j + 2); j += 2; continue; }
        if (d === '`') { j += 1; break; }
        if (d === '$' && source[j + 1] === '{') {
          let depth = 1;
          let k = j + 2;
          while (k < n && depth > 0) {
            if (source[k] === '{') depth += 1;
            else if (source[k] === '}') depth -= 1;
            k += 1;
          }
          blank(j, k);
          j = k;
          continue;
        }
        if (d !== '\n') blank(j, j + 1);
        j += 1;
      }
      i = Math.min(j, n);
      lastMeaning = '`';
      continue;
    }
    if (!/\s/.test(c)) lastMeaning = c;
    i += 1;
  }
  return out.join('');
}

/**
 * 从对象字面量的 `{` 往左找它所属调用的左括号（在 maskLiterals 抹好的源码上走）。
 * 判据是「包含该 attributes 的**最内层对象字面量**归属哪个调用」，所以第 2/3 位置参数里的
 * 对象也该归到同一个调用。允许越过：空白、`,`（它前面还有位置参数）、`[`（数组壳，
 * 如 `foo([{...}])`）以及任何已配对的括号内容；一旦在同层撞上 `;` `=` `:` `?` `}` 等就放弃
 * —— 猜不准就返回 -1，让它留在「无法归属」里留痕，不硬塞成某个模型的归属。
 */
function findEnclosingCallParen(masked, openBrace, maxBack = 6000) {
  let depth = 0;
  let i = openBrace - 1;
  const floor = Math.max(0, openBrace - maxBack);
  while (i >= floor) {
    const c = masked[i];
    if (c === ')' || c === ']' || c === '}') {
      depth += 1;
      i -= 1;
      continue;
    }
    if (c === '(' || c === '[' || c === '{') {
      if (depth > 0) {
        depth -= 1;
        i -= 1;
        continue;
      }
      if (c === '(') return i;
      if (c === '[') {
        i -= 1;
        continue;
      }
      return -1;
    }
    if (depth === 0 && c === ',') {
      i -= 1;
      continue;
    }
    if (depth > 0 || /[\w$\s.]/.test(c)) {
      i -= 1;
      continue;
    }
    return -1;
  }
  return -1;
}

/** 找包含 idx 的最内层 `{`（喂 maskLiterals 抹过的源码：字符串/注释里的花括号不算数） */
function findEnclosingOpenBrace(source, idx) {
  let depth = 0;
  for (let i = idx - 1; i >= 0; i -= 1) {
    if (source[i] === '}') depth += 1;
    else if (source[i] === '{') {
      if (depth === 0) return i;
      depth -= 1;
    }
  }
  return -1;
}

function matchBrace(source, openIdx) {
  let depth = 0;
  for (let i = openIdx; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** 在对象字面量的 depth==1 上找 key 的值表达式（避开嵌套 include 里的同名 key） */
function findDepth1Value(source, openIdx, closeIdx, key) {
  const body = source.slice(openIdx + 1, closeIdx);
  // body 在对象字面量内部，顶层键就在 depth 1
  let depth = 1;
  let i = 0;
  const re = /([A-Za-z_$][\w$]*)\s*:|\{|\}|'[^']*'|"[^"]*"|`[^`]*`|\/\/[^\n]*|\/\*[\s\S]*?\*\//g;
  let m;
  while ((m = re.exec(body))) {
    const tok = m[0];
    if (tok === '{') depth += 1;
    else if (tok === '}') depth -= 1;
    else if (m[1] && depth === 1 && m[1] === key) {
      i = openIdx + 1 + m.index + tok.length;
      return body.slice(m.index + tok.length).split(/[,\n}]/)[0].trim();
    }
  }
  return null;
}

/**
 * 把 attributes 字面量归属到某个模型表达式。masked 是 source 的 maskLiterals 结果（下标对齐）。
 * - include 对象里有 `model:` → 用 include 的模型；
 * - 否则找**包含它的最内层对象字面量**所属的那个调用（findEnclosingCallParen）：
 *   `this.Message.findAll({...})` → this.Message；
 *   `Document.findByPk(id, { attributes })` → Document（options 落在第 2 位置参数同样算）；
 *   `this.db.models.user_profile.findAll({...})` → 额外带上 table='user_profile'（origin 'db-models'），
 *   由调用方用 resolveModelAccessName 把蛇形表名映射到模型名；
 *   形如 `getSourceAttachments(this.db, ids, {...})` / `roleData.getXxx({...})` 的第三方上下文
 *   callee 落不到模型别名上 → 无法归属，跳过（不误报）。
 */
function resolveContext(source, masked, attIndex) {
  const openBrace = findEnclosingOpenBrace(masked, attIndex);
  if (openBrace < 0) return null;
  const closeBrace = matchBrace(masked, openBrace);
  if (closeBrace > 0) {
    const modelValue = findDepth1Value(source, openBrace, closeBrace, 'model');
    if (modelValue) return { expr: modelValue, origin: 'include-model' };
  }
  const paren = findEnclosingCallParen(masked, openBrace);
  if (paren < 0) return null;
  const before = source.slice(Math.max(0, paren - 400), paren);
  const dbModels = DB_MODELS_CALL_RE.exec(before);
  const table = dbModels ? (dbModels[1] || dbModels[3]) : null;
  const callee = /((?:this\.(?:models\.)?[\w$]+|[\w$]+))\.[A-Za-z_$][\w$]*\s*$/.exec(before);
  if (table) return { expr: callee ? callee[1] : `db.models.${table}`, table, origin: 'db-models' };
  if (callee) return { expr: callee[1], origin: 'call' };
  return null;
}

/**
 * `db.models.<name>.<findMethod>(` / `db.models['<name>'].<findMethod>(` 形态。
 * 只认查询类方法名，且输入是「到调用左括号为止」的源码前缀（故正则末尾带 `$`），
 * 免得把 `const M = db.models.foo;` 之类的取模型引用误当成查询上下文。
 */
const DB_MODELS_CALL_RE = /\.models\s*(?:\.\s*([\w$]+)|\[\s*(['"`])\s*([\w$-]+)\s*\2\s*\])\s*\.\s*(?:findAll|findOne|findByPk|findAndCountAll|count)\s*$/;

/**
 * `db.models` 上的访问名 → modelFields 的键（== models/<文件名>.js 的模型名）。
 * 本仓 models/ 由 sequelize-auto 生成：class 名 == 文件名 == db.models 的访问名
 * （见 models/init-models.js：`const user_profile = _user_profile.init(...)` 后原样挂进返回值），
 * 所以 `db.models.user_profile` 里的蛇形表名通常**直接**就是 modelFields 的键，不需要手写映射表。
 * 只补两个方向的书写差异归一化（先精确命中，命不中才按候选顺序降级）：
 *   - `-` ↔ `_`：models/system-setting.js 这类带连字符的文件名，里面的 class 名却是 system_setting；
 *   - camelCase → 蛇形：db.models.userProfile → user_profile。
 * 候选名字必须是**真实存在的模型文件名**，否则返回 null（宁可不归属，也不误报）。
 */
function resolveModelAccessName(raw, modelFields) {
  if (!raw) return null;
  const name = raw.trim();
  if (!name || !/^[\w$-]+$/.test(name)) return null;
  const underscored = name.replace(/-/g, '_');
  const hyphenated = name.replace(/_/g, '-');
  const snake = (s) => s.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
  const camel = (s) => s.replace(/_+([a-z0-9])/g, (_m, c) => c.toUpperCase());
  const candidates = [
    name,
    underscored,
    hyphenated,
    snake(underscored),
    snake(hyphenated),
    camel(underscored),
  ];
  for (const candidate of candidates) {
    if (candidate && modelFields.has(candidate)) return candidate;
  }
  return null;
}

/** 收集 `attributes: [...]` 字面量（返回 index + 原始 body） */
function collectAttributesLiterals(source) {
  const out = [];
  const re = /attributes\s*:\s*\[/g;
  let m;
  while ((m = re.exec(source))) {
    const open = source.indexOf('[', m.index);
    let depth = 0;
    let close = -1;
    for (let i = open; i < source.length; i += 1) {
      if (source[i] === '[') depth += 1;
      else if (source[i] === ']') {
        depth -= 1;
        if (depth === 0) { close = i; break; }
      }
    }
    if (close < 0) continue;
    out.push({ index: m.index, body: source.slice(open + 1, close) });
  }
  return out;
}

/**
 * 扫描一份控制器源码。
 * @returns {{violations: Array, scanned: number, unresolved: Array}}
 */
export function scanControllerSource(source, relFile, modelFields) {
  const masked = maskLiterals(source);
  const varMap = buildVarMap(source, modelFields);
  const violations = [];
  const unresolved = [];
  let scanned = 0;

  for (const att of collectAttributesLiterals(source)) {
    // 只处理纯字符串字面量数组：出现嵌套数组 / sequelize.fn 等一律跳过（无法静态判断）
    if (!/^[\s,'"\w-]*$/.test(att.body)) continue;
    const columns = [...att.body.matchAll(/['"]([^'"]+)['"]/g)].map((x) => x[1]);
    if (columns.length === 0) continue;

    const line = source.slice(0, att.index).split('\n').length;

    const context = resolveContext(source, masked, att.index);
    let modelName = context ? resolveModelName(context.expr, varMap) : null;
    // varMap 只登记 `X = db.getModel('m')` 这类别名，认不出 `db.models.<蛇形表名>`：
    // 这条路径上再用 models/ 的真实模型名（含 -/_ 与 camel 归一化）归属一次。
    if (!modelName && context && context.table) modelName = resolveModelAccessName(context.table, modelFields);

    if (!modelName || !modelFields.has(modelName)) {
      // 归属不到的上下文（helper 调用、关联 getter、动态 attributes）不判违规、只留痕，
      // 避免拿不准就发红。
      unresolved.push(`${relFile}:${line} (${context ? `${context.origin} => ${context.expr}` : 'no-context'})`);
      continue;
    }
    scanned += 1;
    const fields = modelFields.get(modelName);
    for (const column of columns) {
      if (fields.has(column)) continue;
      violations.push({
        file: relFile,
        line,
        model: modelName,
        column,
        message: `${relFile}:${line} 模型 ${modelName} 没有列 ${column}`
          + `（attributes 里 SELECT 了不存在的列，运行时会 ER_BAD_FIELD_ERROR 1054）`,
      });
    }
  }
  return { violations, scanned, unresolved };
}

// ---------------------------------------------------------------- 真实源码扫描

test('控制器 attributes 里不得 SELECT 模型不存在的列（#1188 守卫）', () => {
  const modelFields = loadModelFields();
  const files = listFiles(controllersDir, '.js');
  assert.ok(files.length > 0, '没找到任何控制器文件，扫描路径可能写错了');

  const allViolations = [];
  const allUnresolved = [];
  let totalScanned = 0;
  for (const file of files) {
    const rel = path.relative(root, file);
    const source = fs.readFileSync(file, 'utf8');
    const { violations, scanned, unresolved } = scanControllerSource(source, rel, modelFields);
    totalScanned += scanned;
    allViolations.push(...violations);
    allUnresolved.push(...unresolved);
  }

  console.log(`[attributes-guard] 解析模型 ${modelFields.size} 个；校验 attributes 字面量 ${totalScanned} 处；`
    + `无法归属 ${allUnresolved.length} 处；违规 ${allViolations.length} 处`);

  // 假绿护栏 1：解析器必须真的匹配到东西
  assert.ok(
    totalScanned >= MIN_SCANNED_ATTRIBUTES_LITERALS,
    `只校验了 ${totalScanned} 处 attributes 字面量（下限 ${MIN_SCANNED_ATTRIBUTES_LITERALS}），`
      + '解析器可能已失效——零匹配也算不上绿',
  );
  // 假绿护栏 2：无法归属的上下文不该无限增长（helper 调用 / 关联 getter 是已知形态）
  assert.ok(
    allUnresolved.length <= 20,
    `有 ${allUnresolved.length} 处 attributes 无法归属到模型，解析器可能失效：\n${allUnresolved.join('\n')}`,
  );
  // 假绿护栏 3：解析器必须认得 messages 表的真实形态（tokens 已不是列）
  assert.ok(!modelFields.get('message').has('tokens'), 'models/message.js 里出现了 tokens 列？字段解析或模型形态变了');
  assert.ok(modelFields.get('message').has('prompt_tokens'), 'models/message.js 缺 prompt_tokens？字段解析或模型形态变了');

  const unknown = allViolations.filter((v) => !KNOWN_VIOLATIONS.has(`${v.file}|${v.model}|${v.column}`));
  assert.deepEqual(
    unknown.map((v) => v.message),
    [],
    `发现 attributes 引用了不存在的列：\n${unknown.map((v) => `  - ${v.message}`).join('\n')}`,
  );

  // 白名单里的存量违规若已消失，提示可以删名单（不发红，仅留痕）
  for (const key of KNOWN_VIOLATIONS.keys()) {
    const stillThere = allViolations.some((v) => `${v.file}|${v.model}|${v.column}` === key);
    assert.ok(stillThere, `白名单条目 ${key} 已不再出现，请从 KNOWN_VIOLATIONS 里删掉它`);
  }
});

// ---------------------------------------------------------------- 自证有牙

test('守卫有牙：合成源码里塞一个假列必须被判违规', () => {
  const modelFields = new Map([
    ['message', new Set(['id', 'request_id', 'role', 'prompt_tokens', 'completion_tokens'])],
  ]);
  const fake = `
    import { Op } from 'sequelize';
    export default class C {
      constructor(db) { this.Message = db.getModel('message'); }
      async boom(ctx) {
        const rows = await this.Message.findAll({
          attributes: ['id', 'tokens'],
          raw: true,
        });
        return rows;
      }
    }
  `;
  const { violations, scanned } = scanControllerSource(fake, 'server/controllers/fake.controller.js', modelFields);
  assert.equal(scanned, 1, '合成源码里应有 1 处被校验的 attributes 字面量');
  assert.deepEqual(violations.map((v) => v.column), ['tokens']);
  assert.equal(violations[0].model, 'message');
  assert.equal(violations[0].line, 7);
});

test('守卫不误报：include 块里 attributes 归属到 include 的模型', () => {
  const modelFields = new Map([
    ['ai_model', new Set(['id', 'name', 'provider_id'])],
    ['provider', new Set(['id', 'name'])],
  ]);
  const src = `
    export default class C {
      constructor(db) { this.AiModel = db.getModel('ai_model'); }
      async list(ctx) {
        return this.AiModel.findAll({
          include: [{ model: db.getModel('provider'), attributes: ['id', 'name'] }],
          attributes: ['id', 'name', 'provider_id'],
          raw: true,
        });
      }
    }
  `;
  const { violations, scanned } = scanControllerSource(src, 'x.js', modelFields);
  assert.deepEqual(violations, []);
  assert.equal(scanned, 2);
});

/**
 * 盲区回归（#1188 收尾）：归属逻辑以前只认 `include: [{ model }]` 与 `this.X.findAll({...})`，
 * `this.db.models.<蛇形表名>.findAll({...})` 会落进「无法归属」而静默放行
 * （实测：往 topic.controller.js:306 的 attributes 里塞 bogus_column_zzz 守卫仍全绿）。
 */
test('守卫有牙：db.models.<蛇形表名>.findAll 形态的假列必须被抓住', () => {
  const modelFields = new Map([
    ['user_profile', new Set(['id', 'user_id', 'expert_id', 'last_active'])],
  ]);
  const src = `
    export default class C {
      constructor(ctx) { this.db = ctx.db; }
      async list(ctx) {
        const experts = await this.db.models.user_profile.findAll({
          where: { user_id: ctx.state.session.id },
          attributes: ['expert_id', 'bogus_column_zzz'],
          raw: true,
        });
        return experts;
      }
    }
  `;
  const { violations, scanned, unresolved } = scanControllerSource(src, 'server/controllers/fake.controller.js', modelFields);
  assert.deepEqual(unresolved, [], 'db.models.<蛇形表名> 形态不应再落进无法归属');
  assert.equal(scanned, 1);
  assert.deepEqual(
    violations.map((v) => `${v.model}:${v.column}:${v.line}`),
    ['user_profile:bogus_column_zzz:7'],
  );
});

test('守卫：db.models["<表名>"] 下标与 -/_ 差异同样归属；关联 getter 仍不硬塞', () => {
  const modelFields = new Map([
    ['user_profile', new Set(['id', 'user_id', 'expert_id'])],
    // models/system-setting.js 里 class 名是 system_setting，db.models 上的访问名带下划线
    ['system-setting', new Set(['id', 'key'])],
  ]);
  const src = `
    class C {
      async a(db) {
        return db.models['user_profile'].findOne({ where: { id: 1 }, attributes: ['expert_id', 'nope_a'], raw: true });
      }
      async b(db) {
        return db.models.system_setting.count({ attributes: ['key', 'nope_b'] });
      }
      async c(roleData) {
        return roleData.getPermission_id_permissions({ attributes: ['code', 'nope_c'] });
      }
    }
  `;
  const { violations, scanned, unresolved } = scanControllerSource(src, 'x.js', modelFields);
  assert.equal(scanned, 2, '下标写法与 -/_ 差异两处应被校验');
  assert.deepEqual(
    violations.map((v) => `${v.model}:${v.column}`),
    ['user_profile:nope_a', 'system-setting:nope_b'],
  );
  // 第三方上下文（关联 getter）依旧只能留痕，不能为了降「无法归属」计数把它归到某个模型上造成误报
  assert.equal(unresolved.length, 1);
  assert.match(unresolved[0], /getPermission|roleData|no-context/);
});

/**
 * 盲区回归（#1193 ①）：options 落在**第二个位置参数**里的调用。
 * 旧实现「从 attributes 往前找所属调用，但在遇到 `{` 之前碰到 `,` 就放弃」，
 * 于是 `Document.findByPk(sourceId, { attributes: [...] })` 归不到模型
 * （实测：往 attachment.controller.js:310 塞假列，守卫仍 5 pass / 0 fail）。
 * 判据应是「包含该 attributes 的最内层对象字面量归属哪个调用」，与它是第几个位置参数无关。
 */
test('守卫有牙：options 在第 2/3 位置参数的调用假列必须被抓住（#1193①）', () => {
  const modelFields = new Map([
    ['document', new Set(['id', 'title'])],
    ['document_revision', new Set(['id', 'document_id'])],
  ]);
  const src = `
    export default class C {
      async find(ctx) {
        const Document = this.db.getModel('document');
        const DocumentRevision = ctx.db.getModel('document_revision');
        const document = await Document.findByPk(ctx.params.id, { attributes: ['id', 'zzz_probe_a1'], raw: true });
        const revision = await DocumentRevision.findByPk(ctx.params.id, {
          attributes: ['document_id', 'zzz_probe_b1'],
          raw: true,
        });
        const files = await getSourceAttachments(this.db, [1, 2], { attributes: ['zzz_probe_c1'] });
        return { document, revision, files };
      }
    }
  `;
  const { violations, scanned, unresolved } = scanControllerSource(src, 'server/controllers/fake.controller.js', modelFields);
  assert.equal(scanned, 2, '第 2 位置参数里的两处 attributes 应被校验');
  assert.deepEqual(
    violations.map((v) => `${v.model}:${v.column}:${v.line}`),
    ['document:zzz_probe_a1:6', 'document_revision:zzz_probe_b1:8'],
  );
  // 第三方 helper 的第 3 位置参数照旧只能留痕，不许硬塞成某个模型的归属
  assert.equal(unresolved.length, 1, 'getSourceAttachments(this.db, ids, {...}) 应继续留在无法归属里');
  assert.match(unresolved[0], /no-context|getSourceAttachments/);
  assert.ok(!violations.some((v) => v.column === 'zzz_probe_c1'), '归不到模型的第三方调用不该判违规');
});

/**
 * 盲区回归（#1193 ②）：模型被赋值给局部变量后再用（传递别名）。
 * 真实形态见 doc.controller.js：`this.models.DocVersion = this.db.getModel('document_revision')`（:83）
 * → `const Version = this.models.DocVersion;`（:1389）→ `Version.findAll({ attributes: [...] })`（:1398）。
 * 旧 buildVarMap 只登记 `= db.getModel('…')`，这条链断在最后一跳。
 */
test('守卫有牙：传递别名（this.models.X → 局部变量）的假列必须被抓住（#1193②）', () => {
  const modelFields = new Map([
    ['document_revision', new Set(['id', 'document_id', 'revision_label'])],
    ['doc_tag', new Set(['id', 'name'])],
  ]);
  const src = `
    export default class C {
      constructor(ctx) {
        this.models = {};
        this.models.DocVersion = ctx.db.getModel('document_revision');
        this.models.DocTag = ctx.db.getModel('doc_tag');
      }
      async rename(ctx) {
        const Version = this.models.DocVersion;
        const Tag = this.models.DocTag;
        const siblings = await Version.findAll({
          where: { document_id: 1 },
          attributes: ['id', 'revision_label', 'zzz_probe_a2'],
          raw: true,
        });
        const tags = await Tag.findAll({ attributes: ['id', 'nope_tag'] });
        const others = await SomethingElse.findAll({ attributes: ['zzz_probe_unresolved'] });
        return { siblings, tags, others };
      }
    }
  `;
  const { violations, scanned, unresolved } = scanControllerSource(src, 'server/controllers/fake.controller.js', modelFields);
  assert.equal(scanned, 2, '两处传递别名上的 attributes 都应被校验');
  assert.deepEqual(
    violations.map((v) => `${v.model}:${v.column}:${v.line}`),
    ['document_revision:zzz_probe_a2:13', 'doc_tag:nope_tag:16'],
  );
  assert.equal(unresolved.length, 1, '没登记过的 SomethingElse 仍应留痕，不许猜模型');
  assert.match(unresolved[0], /SomethingElse/);
});
