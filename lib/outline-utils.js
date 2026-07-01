import crypto from 'crypto';

export function splitWithOverlap(text, windowSize, stepSize) {
  if (!text || text.length <= windowSize) {
    return text ? [{ text, lineOffset: 0 }] : [];
  }

  const chunks = [];
  const lines = text.split('\n');
  let pos = 0;
  let lineOffset = 0;

  while (pos < text.length) {
    const endPos = Math.min(pos + windowSize, text.length);
    
    let chunkText = text.slice(pos, endPos);
    
    if (endPos < text.length) {
      const lastNewline = chunkText.lastIndexOf('\n');
      if (lastNewline > 0) {
        chunkText = chunkText.slice(0, lastNewline + 1);
      }
    }

    const chunkLineCount = chunkText.split('\n').length - (chunkText.endsWith('\n') ? 1 : 0);
    
    chunks.push({
      text: chunkText,
      lineOffset,
      startPos: pos,
      lineCount: chunkLineCount,
    });

    const actualStep = stepSize;
    pos += actualStep;
    
    if (pos < text.length) {
      const nextStart = text.slice(pos, pos + 100);
      const firstNewlineIdx = nextStart.indexOf('\n');
      if (firstNewlineIdx >= 0) {
        pos = pos + firstNewlineIdx + 1;
      }
      
      lineOffset = countLinesBeforePosition(text, pos);
    }
  }

  return chunks;
}

function countLinesBeforePosition(text, position) {
  let count = 0;
  for (let i = 0; i < position && i < text.length; i++) {
    if (text[i] === '\n') count++;
  }
  return count;
}

export function mergeOutlines(chunkData, options = {}) {
  const deduplicateTitles = options.deduplicateTitles !== false;
  const proximityThreshold = options.proximityThreshold || 50;

  const all = [];

  for (const chunk of chunkData) {
    const outlines = chunk.outlines;
    const lineOffset = chunk.lineOffset || 0;

    if (!Array.isArray(outlines)) continue;

    for (const o of outlines) {
      const title = (o.title || '').trim();
      if (!title) continue;

      all.push({
        title,
        description: o.summary || o.description || '',
        level: o.level || 1,
        from_line: (o.from_line || 0) + lineOffset,
        to_line: (o.to_line || 0) + lineOffset,
        seq: -1,
      });
    }
  }

  all.sort((a, b) => a.from_line - b.from_line);

  if (!deduplicateTitles) {
    for (let i = 0; i < all.length; i++) {
      all[i].seq = i;
    }
    return all;
  }

  const deduped = [];
  for (const o of all) {
    const isDuplicate = deduped.some(existing => {
      if (existing.title.toLowerCase() !== o.title.toLowerCase()) return false;
      const lineDiff = Math.abs(existing.from_line - o.from_line);
      return lineDiff <= proximityThreshold;
    });

    if (!isDuplicate) {
      o.seq = deduped.length;
      deduped.push(o);
    }
  }

  for (let i = 0; i < deduped.length; i++) {
    const current = deduped[i];
    if (i < deduped.length - 1) {
      current.to_line = Math.min(current.to_line, deduped[i + 1].from_line - 1);
    }
  }

  return deduped;
}

export function extractTextByLineRange(text, fromLine, toLine) {
  const lines = text.split('\n');
  const startIdx = Math.max(0, fromLine - 1);
  const endIdx = Math.min(lines.length, toLine);
  return lines.slice(startIdx, endIdx).join('\n');
}

export function computeTextStats(text) {
  if (!text) {
    return { textHash: '', byteCount: 0, tokenCount: 0 };
  }

  const textHash = crypto.createHash('sha256').update(text, 'utf8').digest('hex').slice(0, 64);
  const byteCount = Buffer.byteLength(text, 'utf8');
  const tokenCount = estimateTokenCount(text);

  return { textHash, byteCount, tokenCount };
}

export function estimateTokenCount(text) {
  if (!text) return 0;
  
  const chineseChars = (text.match(/[\u4e00-\u9fff]/g) || []).length;
  const englishWords = (text.match(/[a-zA-Z]+/g) || []).length;
  const numbers = (text.match(/\d+/g) || []).length;
  const otherChars = text.length - chineseChars - (text.match(/[a-zA-Z]+/g) || []).join('').length - (text.match(/\d+/g) || []).join('').length;

  return Math.ceil(chineseChars * 0.5 + englishWords + numbers * 0.5 + otherChars * 0.25);
}

export function buildOutlinePrompt(maxLevel) {
  return `分析以下文本的章节结构，识别标题层级。

你必须只返回合法 JSON，不要返回解释、正文、Markdown 标题、代码围栏或任何额外说明。

请返回 JSON 格式：
{
  "outlines": [
    {
      "title": "章节标题",
      "level": 1,
      "from_line": 行号（从1开始）,
      "to_line": 结束行号,
      "summary": "章节内容简短摘要"
    }
  ]
}

要求：
1. 只识别标题，不要把正文内容当作章节
2. 输出必须是单个 JSON 对象，顶层字段必须为 outlines
3. 不要输出 json 代码块或三反引号包裹内容
4. 不要输出“下面是结果”之类的说明文字
5. 若无法识别章节，返回 {"outlines": []}
6. level 表示标题层级，1为最高级
7. from_line 为标题所在行号
8. to_line 为该章节内容结束行号（下一章节开始前一行）
9. 最大识别层级不超过 ${maxLevel}
10. 确保每个章节的 to_line >= from_line`;
}

export function parseOutlineResponse(response) {
  if (!response) return null;

  if (typeof response === 'object') {
    if (Array.isArray(response)) return response;
    return response.outlines || response;
  }

  if (typeof response === 'string') {
    let text = response.trim();
    if (text.startsWith('```')) {
      text = text.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
    }
    const candidateBlocks = [];
    const objectMatch = text.match(/\{[\s\S]*\}/);
    const arrayMatch = text.match(/\[[\s\S]*\]/);
    if (objectMatch) candidateBlocks.push(objectMatch[0]);
    if (arrayMatch) candidateBlocks.push(arrayMatch[0]);

    for (const candidate of candidateBlocks) {
      try {
        const parsed = JSON.parse(candidate);
        if (Array.isArray(parsed)) return parsed;
        if (parsed && typeof parsed === 'object') {
          if (Array.isArray(parsed.outlines)) return parsed.outlines;
          return parsed;
        }
      } catch {
      }
    }

    const fallback = parseOutlineTextFallback(text);
    if (fallback.length > 0) {
      return fallback;
    }
  }

  return null;
}

function parseOutlineTextFallback(text) {
  if (!text) return [];

  const lines = text.split(/\r?\n/);
  const outlines = [];

  const headingPatterns = [
    /^(第[一二三四五六七八九十百千万0-9]+[章节部分篇编卷]\s+.+)$/,
    /^(\d+(?:\.\d+){0,4})\s+(.+)$/,
    /^([一二三四五六七八九十]+[、.．])\s*(.+)$/,
    /^(附录\s*[A-Z0-9一二三四五六七八九十]*)\s+(.+)$/,
    /^(GB\/T\s*[^\s]+.*)$/,
  ];

  for (let index = 0; index < lines.length; index++) {
    const rawLine = lines[index];
    const line = rawLine.trim();
    if (!line || line.length > 120) continue;

    let matched = false;
    for (const pattern of headingPatterns) {
      const match = line.match(pattern);
      if (match) {
        outlines.push({
          title: line,
          level: inferOutlineLevel(line),
          from_line: index + 1,
          to_line: index + 1,
          summary: '',
        });
        matched = true;
        break;
      }
    }

    if (!matched && /^#\s+/.test(line)) {
      outlines.push({
        title: line.replace(/^#\s+/, '').trim(),
        level: 1,
        from_line: index + 1,
        to_line: index + 1,
        summary: '',
      });
    }
  }

  for (let index = 0; index < outlines.length; index++) {
    const current = outlines[index];
    const next = outlines[index + 1];
    current.to_line = next ? Math.max(current.from_line, next.from_line - 1) : current.from_line;
  }

  return outlines;
}

function inferOutlineLevel(title) {
  const numbered = title.match(/^(\d+(?:\.(\d+))+)/);
  if (numbered) {
    return Math.min(numbered[1].split('.').length, 6);
  }
  if (/^第.+[章节部分篇编卷]/.test(title)) return 1;
  if (/^[一二三四五六七八九十]+[、.．]/.test(title)) return 2;
  if (/^附录/.test(title)) return 1;
  return 1;
}