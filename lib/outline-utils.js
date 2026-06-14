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
2. level 表示标题层级，1为最高级
3. from_line 为标题所在行号
4. to_line 为该章节内容结束行号（下一章节开始前一行）
5. 最大识别层级不超过 ${maxLevel}
6. 确保每个章节的 to_line >= from_line`;
}

export function parseOutlineResponse(response) {
  if (!response) return null;

  if (typeof response === 'object') {
    return response.outlines || response;
  }

  if (typeof response === 'string') {
    let text = response.trim();
    if (text.startsWith('```')) {
      text = text.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
    }
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    try {
      const parsed = JSON.parse(jsonMatch[0]);
      return parsed.outlines || parsed;
    } catch {
      return null;
    }
  }

  return null;
}