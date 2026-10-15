import { expect } from 'chai';
import { parseJsonLikeContent } from '../../lib/json-parse-utils.js';

describe('parseJsonLikeContent', () => {
  describe('pure JSON', () => {
    it('should parse valid JSON object', () => {
      const result = parseJsonLikeContent('{ "status": "success", "progress": 50 }');
      expect(result).to.deep.equal({ status: 'success', progress: 50 });
    });

    it('should parse valid JSON array', () => {
      const result = parseJsonLikeContent('[1, 2, 3]');
      expect(result).to.deep.equal([1, 2, 3]);
    });

    it('should parse JSON with _raw field without false negative', () => {
      const input = '{ "_raw": "source text", "status": "ok" }';
      const result = parseJsonLikeContent(input);
      expect(result).to.deep.equal({ _raw: 'source text', status: 'ok' });
      expect(result).to.not.have.property('_parse_failed');
    });
  });

  describe('code block wrapped JSON', () => {
    it('should parse JSON wrapped in ```json```', () => {
      const input = '```json\n{ "status": "done" }\n```';
      expect(parseJsonLikeContent(input)).to.deep.equal({ status: 'done' });
    });

    it('should parse JSON wrapped in ``` (no lang)', () => {
      const input = '```\n{ "status": "done" }\n```';
      expect(parseJsonLikeContent(input)).to.deep.equal({ status: 'done' });
    });
  });

  describe('mixed text with JSON', () => {
    it('should extract JSON object from mixed text', () => {
      const input = 'Here is the result: { "status": "success", "progress": 100 } Done.';
      expect(parseJsonLikeContent(input)).to.deep.equal({ status: 'success', progress: 100 });
    });

    it('should extract JSON array from mixed text', () => {
      const input = 'The items are: [1, 2, 3] as requested.';
      expect(parseJsonLikeContent(input)).to.deep.equal([1, 2, 3]);
    });
  });

  describe('fallback behavior', () => {
    it('should return _parse_failed marker on failure with returnRawOnFail=true', () => {
      const result = parseJsonLikeContent('plain text without JSON', { returnRawOnFail: true });
      expect(result).to.have.property('_parse_failed');
      expect(result._parse_failed).to.equal(true);
      expect(result).to.have.property('_raw');
      expect(result._raw).to.equal('plain text without JSON');
    });

    it('should return null on complete failure with returnRawOnFail=false', () => {
      const result = parseJsonLikeContent('plain text without JSON', { returnRawOnFail: false });
      expect(result).to.be.null;
    });

    it('should return _parse_failed marker for empty string with returnRawOnFail=true', () => {
      const result = parseJsonLikeContent('', { returnRawOnFail: true });
      expect(result).to.have.property('_parse_failed');
      expect(result._raw).to.equal('');
    });

    it('should return null for null/undefined input with returnRawOnFail=false', () => {
      expect(parseJsonLikeContent(null, { returnRawOnFail: false })).to.be.null;
      expect(parseJsonLikeContent(undefined, { returnRawOnFail: false })).to.be.null;
    });
  });

  describe('edge cases', () => {
    it('should handle nested JSON objects', () => {
      const input = '{ "outer": { "inner": "value" } }';
      expect(parseJsonLikeContent(input)).to.deep.equal({ outer: { inner: 'value' } });
    });

    it('should handle JSON with whitespace', () => {
      const input = '  {  "key"  :  "value"  }  ';
      expect(parseJsonLikeContent(input)).to.deep.equal({ key: 'value' });
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // #1216：平衡扫描（替换贪婪正则）新增覆盖，类别①～⑧ + 截断型取舍钉住
  // ─────────────────────────────────────────────────────────────────────────
  describe('#1216 balanced brace scan', () => {
    // ① 尾话带 `}`：贪婪正则会把截取范围撑到尾话的最后一个 `}`
    it('① stops at the balanced close when trailing prose contains "}"', () => {
      const input = '{"score":7,"note":"ok"}\n补充：字段 {next_action} 需要人工确认。';
      expect(parseJsonLikeContent(input)).to.deep.equal({ score: 7, note: 'ok' });
    });

    it('① trailing prose with } after a fenced-wrapped object', () => {
      const input = '```json\n{"status":"done"}\n```\n注：占位符 {id} 已替换。';
      expect(parseJsonLikeContent(input)).to.deep.equal({ status: 'done' });
    });

    // ② 并列两个对象：取前一个能解析的
    it('② returns the first of two sibling objects', () => {
      const input = '{"a":1,"t":"x"}\n{"b":2}';
      expect(parseJsonLikeContent(input)).to.deep.equal({ a: 1, t: 'x' });
    });

    it('② skips a closed-but-unparseable first object and takes the next', () => {
      const input = '{bad: true} then {"ok":true}';
      expect(parseJsonLikeContent(input)).to.deep.equal({ ok: true });
    });

    // ③ 字符串值内含 `}` / `{`
    it('③ ignores braces inside string values', () => {
      const input = '{"s":"a } brace and { more","x":1} tail }';
      expect(parseJsonLikeContent(input)).to.deep.equal({ s: 'a } brace and { more', x: 1 });
    });

    it('③ object whose only closing-looking } is inside a string before the real close', () => {
      const input = '前缀 {"s":"} 不是结束","k":2} 后缀';
      expect(parseJsonLikeContent(input)).to.deep.equal({ s: '} 不是结束', k: 2 });
    });

    // ④ 值内含转义引号 \"（不处理转义会把字符串提前终止，再把串内 `}` 当闭合）
    // 尾部带括号垃圾，逼输入必须走提取路径，否则整段自身就是合法 JSON 会被严格解析短路。
    it('④ handles escaped quotes inside string values', () => {
      const input = '{"s":"inner \\"} quote","t":2}\n补充：{x} 占位。';
      expect(parseJsonLikeContent(input)).to.deep.equal({ s: 'inner "} quote', t: 2 });
    });

    it('④ handles a string ending with an escaped backslash', () => {
      // 值为 x\ —— 若把收尾的 \\" 误判为转义引号，字符串就不会在正确位置结束
      const input = '{"a":"x\\\\","b":"}y"} 备注 }';
      expect(parseJsonLikeContent(input)).to.deep.equal({ a: 'x\\', b: '}y' });
    });

    // ⑤ 深层嵌套（对象/数组混合）+ 尾话括号
    it('⑤ handles deep nesting with mixed braces and brackets', () => {
      const inner = '{"a":{"b":{"c":[1,[2,{"d":"} in string"}]]}}}'
      const input = `分析结果：${inner}\n另见 {ref} 说明。`;
      expect(parseJsonLikeContent(input)).to.deep.equal({
        a: { b: { c: [1, [2, { d: '} in string' }]] } },
      });
    });

    // ⑥ 未闭合（截断型）：整体判失败，不返回内层碎片
    it('⑥ truncated object fails cleanly instead of returning an inner fragment', () => {
      const input = '{"session_meta":{"topic":"t"},"methodology":{"phase":"x"';
      const result = parseJsonLikeContent(input, { returnRawOnFail: true });
      expect(result).to.have.property('_parse_failed', true);
      expect(result._raw).to.equal(input);
      expect(parseJsonLikeContent(input, { returnRawOnFail: false })).to.be.null;
    });

    it('⑥ truncated array fails cleanly too', () => {
      const input = '[1,2,[3,4';
      expect(parseJsonLikeContent(input, { returnRawOnFail: false })).to.be.null;
    });

    it('⑥ unclosed "{" in prose before a complete object fails (documented trade-off, same as old greedy)', () => {
      // 取舍见 lib/json-parse-utils.js findBalancedCandidates 注释：
      // 未闭合起点之后的候选全是该 span 内的残片，宁缺勿滥。
      const input = 'I think { is weird. {"a":1}';
      expect(parseJsonLikeContent(input, { returnRawOnFail: false })).to.be.null;
    });

    // ⑦ 前面是垃圾文字且第一个 `{` 属于垃圾（垃圾前缀自己闭合、解析不了）
    it('⑦ skips a garbage prefix whose first "{" is not the JSON', () => {
      const input = '好的，来了！字段 {next_action} 是自动填充的：\n{"result":"ok","score":9} 完毕。';
      expect(parseJsonLikeContent(input)).to.deep.equal({ result: 'ok', score: 9 });
    });

    // ⑧ array 版 ①～⑤
    it('⑧a array + trailing prose with "]"', () => {
      const input = '[1,2,3]\n注：数组 [x] 只是示例。';
      expect(parseJsonLikeContent(input)).to.deep.equal([1, 2, 3]);
    });

    it('⑧b array with brackets inside string values', () => {
      const input = '["a ] b","[x"] tail ]';
      expect(parseJsonLikeContent(input)).to.deep.equal(['a ] b', '[x']);
    });

    it('⑧b pre-existing contract: a parseable object anywhere outranks a top-level array', () => {
      // 三级降级顺序里对象提取在数组之前（红线 1，旧贪婪正则同款行为）：
      // 数组内嵌对象若自身可解析，降级路径会先命中它，返回对象而非整个数组。
      const input = '[{"s":"a ] b"},2] tail ]';
      expect(parseJsonLikeContent(input)).to.deep.equal({ s: 'a ] b' });
    });

    it('⑧c array with escaped quotes in string values', () => {
      const input = '["a\\"b]", "c"] 完 ]';
      expect(parseJsonLikeContent(input)).to.deep.equal(['a"b]', 'c']);
    });

    it('⑧d two sibling arrays returns the first', () => {
      const input = '[1]\n[2]';
      expect(parseJsonLikeContent(input)).to.deep.equal([1]);
    });

    it('⑧e deep nested array with garbage prefix and trailing prose', () => {
      const input = '结果 {见下}：[[1,[2,[3]]],[[4]]] 补充：[略]';
      expect(parseJsonLikeContent(input)).to.deep.equal([[1, [2, [3]]], [[4]]]);
    });

    // 旧契约复核：对象提取失败后仍要轮到数组（三级降级顺序不变）
    it('falls through to array extraction when object candidates all fail', () => {
      const input = '{bad} and [1,2] yes }';
      expect(parseJsonLikeContent(input)).to.deep.equal([1, 2]);
    });

    // 钉住已知取舍：起点从前往后，「能解析的先赢」。若垃圾前缀碰巧自身是合法 JSON
    // （空对象 `{}` 这类），它会赢过后面真正的主体 JSON（旧贪婪正则对此整段判失败）。
    it('documented trade-off: an earliest parsable garbage fragment wins', () => {
      const input = '{} 说明：{"a":1}';
      expect(parseJsonLikeContent(input)).to.deep.equal({});
    });
  });
});