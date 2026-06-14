import crypto from 'crypto';

export function buildChunksFromOutlines(fullText, outlines, options = {}) {
  const {
    maxLength = 1000,
    overlapLength = 100,
    keepHeading = true,
    mergeSmallChunks = false,
  } = options;

  if (!outlines || outlines.length === 0) {
    return [];
  }

  const lines = fullText.split('\n');
  const chunks = [];
  let seq = 0;

  for (const outline of outlines) {
    const startLine = outline.from_line;
    const endLine = outline.to_line;
    const title = outline.title || '';

    const sectionLines = lines.slice(startLine - 1, endLine);
    const sectionText = sectionLines.join('\n');

    if (!sectionText.trim()) continue;

    const headingSuffix = keepHeading ? title : '';
    const sectionTokens = estimateTokenCount(sectionText);
    const headingTokens = keepHeading ? estimateTokenCount(title) : 0;
    const effectiveMaxLength = maxLength - headingTokens;

    if (sectionTokens <= effectiveMaxLength) {
      chunks.push({
        outline_id: outline.id,
        title: headingSuffix || null,
        content: keepHeading ? `${title}\n\n${sectionText}` : sectionText,
        seq: seq++,
        from_line: startLine,
        to_line: endLine,
      });
    } else {
      const subChunks = splitLongSection(sectionLines, effectiveMaxLength, overlapLength, keepHeading, title, startLine);
      for (const sc of subChunks) {
        chunks.push({
          outline_id: outline.id,
          title: headingSuffix || null,
          content: sc.content,
          seq: seq++,
          from_line: sc.from_line,
          to_line: sc.to_line,
        });
      }
    }
  }

  if (mergeSmallChunks && chunks.length > 1) {
    return mergeSmallChunksImpl(chunks, maxLength);
  }

  return chunks;
}

function splitLongSection(lines, maxTokens, overlapLength, keepHeading, title, globalStartLine) {
  const chunks = [];
  let currentLines = [];
  let currentTokens = 0;
  let chunkStartLine = globalStartLine;

  const effectiveMaxTokens = keepHeading ? maxTokens - estimateTokenCount(title) : maxTokens;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineTokens = estimateTokenCount(line);

    if (currentTokens + lineTokens > effectiveMaxTokens && currentLines.length > 0) {
      const content = keepHeading
        ? `${title}\n\n${currentLines.join('\n')}`
        : currentLines.join('\n');

      chunks.push({
        content,
        from_line: chunkStartLine,
        to_line: globalStartLine + i - 1,
      });

      if (overlapLength > 0 && currentLines.length > 1) {
        const overlapLines = [];
        let overlapTokens = 0;
        for (let j = currentLines.length - 1; j >= 0; j--) {
          const t = estimateTokenCount(currentLines[j]);
          if (overlapTokens + t > overlapLength) break;
          overlapLines.unshift(currentLines[j]);
          overlapTokens += t;
        }
        currentLines = overlapLines;
        currentTokens = overlapTokens;
        chunkStartLine = globalStartLine + i - overlapLines.length;
      } else {
        currentLines = [];
        currentTokens = 0;
        chunkStartLine = globalStartLine + i;
      }
    }

    currentLines.push(line);
    currentTokens += lineTokens;
  }

  if (currentLines.length > 0) {
    const content = keepHeading
      ? `${title}\n\n${currentLines.join('\n')}`
      : currentLines.join('\n');

    chunks.push({
      content,
      from_line: chunkStartLine,
      to_line: globalStartLine + lines.length - 1,
    });
  }

  return chunks;
}

function mergeSmallChunksImpl(chunks, maxLength) {
  if (chunks.length <= 1) return chunks;

  const merged = [chunks[0]];

  for (let i = 1; i < chunks.length; i++) {
    const last = merged[merged.length - 1];
    const current = chunks[i];

    if (last.outline_id === current.outline_id) {
      const combinedTokens = estimateTokenCount(last.content) + estimateTokenCount(current.content);
      if (combinedTokens <= maxLength) {
        last.content = `${last.content}\n${current.content}`;
        last.to_line = current.to_line;
        continue;
      }
    }

    merged.push(current);
  }

  for (let i = 0; i < merged.length; i++) {
    merged[i].seq = i;
  }

  return merged;
}

export function estimateTokenCount(text) {
  if (!text) return 0;
  const chineseChars = (text.match(/[\u4e00-\u9fff]/g) || []).length;
  const englishWords = (text.match(/[a-zA-Z]+/g) || []).length;
  const numbers = (text.match(/\d+/g) || []).length;
  const otherChars = text.length - chineseChars - (text.match(/[a-zA-Z]+/g) || []).join('').length - (text.match(/\d+/g) || []).join('').length;
  return Math.ceil(chineseChars * 0.5 + englishWords + numbers * 0.5 + otherChars * 0.25);
}

export function computeChunkStats(content) {
  if (!content) {
    return { textHash: '', byteCount: 0, tokenCount: 0 };
  }
  const textHash = crypto.createHash('sha256').update(content, 'utf8').digest('hex').slice(0, 64);
  const byteCount = Buffer.byteLength(content, 'utf8');
  const tokenCount = estimateTokenCount(content);
  return { textHash, byteCount, tokenCount };
}