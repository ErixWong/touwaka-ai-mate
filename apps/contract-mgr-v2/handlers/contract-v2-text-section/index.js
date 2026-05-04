import logger from '../../../../lib/logger.js';

const CONTENT_TABLE = 'app_contract_mgr_v2_content';
const SECTION_MAX_INPUT_CHARS = 60000;

function getSectionConfig(app) {
  let config = app?.config;
  if (typeof config === 'string') {
    try { config = JSON.parse(config); } catch { config = {}; }
  }
  return config?.step_resources?.pending_section || { type: 'internal_llm', temperature: 0.3 };
}

function getSectionPrompt(app) {
  let config = app?.config;
  if (typeof config === 'string') {
    try { config = JSON.parse(config); } catch { config = {}; }
  }
  return config?.prompts?.section || null;
}

function splitTextIntoChunks(text, maxChars) {
  const paragraphs = text.split('\n\n');
  const chunks = [];
  let current = '';

  for (const para of paragraphs) {
    if (current.length + para.length + 2 <= maxChars) {
      current += (current ? '\n\n' : '') + para;
    } else {
      if (current) chunks.push(current);
      if (para.length > maxChars) {
        const lines = para.split('\n');
        let lineChunk = '';
        for (const line of lines) {
          if (lineChunk.length + line.length + 1 <= maxChars) {
            lineChunk += (lineChunk ? '\n' : '') + line;
          } else {
            if (lineChunk) chunks.push(lineChunk);
            lineChunk = line;
          }
        }
        current = lineChunk;
      } else {
        current = para;
      }
    }
  }
  if (current) chunks.push(current);

  return chunks.length > 0 ? chunks : [text];
}

function parseLlmResponse(response) {
  const resultText = response.text || response.parsed || response;
  if (typeof resultText === 'string') {
    let text = resultText.trim();
    if (text.startsWith('```')) {
      text = text.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
    }
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    const parsed = JSON.parse(jsonMatch[0]);
    return parsed.sections || parsed;
  }
  if (typeof resultText === 'object') return resultText.sections || resultText;
  return null;
}

function mergeSections(chunkResults) {
  const all = [];
  let offset = 0;

  for (const sections of chunkResults) {
    if (!Array.isArray(sections)) continue;
    for (const sec of sections) {
      all.push({
        ...sec,
        start_offset: (sec.start_offset || 0) + offset,
        index: all.length,
      });
    }
    offset += sections.length;
  }

  const seen = new Set();
  return all.filter(s => {
    const key = (s.title || '').trim();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export const availableOutputs = [
  { key: 'section_count', label: '章节数量', type: 'number' },
];

export default {
  availableOutputs,
  async process(context) {
    const { record, services, app } = context;

    logger.info(`[contract-v2-text-section] Processing record ${record.id}`);

    const content = await services.callExtension(CONTENT_TABLE, 'read', {
      row_id: record.id,
      fields: ['filtered_text'],
    });

    if (!content || !content.filtered_text) {
      return { success: false, error: 'No filtered text found in extension table' };
    }

    const text = content.filtered_text;
    logger.info(`[contract-v2-text-section] Record ${record.id}: Filtered text length=${text.length}`);

    const sectionConfig = getSectionConfig(app);
    const sectionPrompt = getSectionPrompt(app);

    const promptBase = sectionPrompt || `分析以下合同文本的章节结构。

返回JSON格式：
{
  "sections": [
    {
      "title": "章节标题",
      "level": 1,
      "index": 0,
      "start_offset": 0,
      "summary": "章节内容摘要"
    }
  ]
}`;

    try {
      let sections;

      if (text.length <= SECTION_MAX_INPUT_CHARS) {
        const response = await services.callLlm('analyze_sections', {
          instruction: promptBase,
          ocr_text: text,
          response_format: 'json',
          model_id: sectionConfig.model_id,
          temperature: sectionConfig.temperature || 0.3,
        });
        sections = parseLlmResponse(response);
        if (!sections) return { success: false, error: 'LLM did not return valid JSON' };
      } else {
        logger.info(`[contract-v2-text-section] Record ${record.id}: Text too long (${text.length} chars), using chunked analysis`);
        const chunks = splitTextIntoChunks(text, SECTION_MAX_INPUT_CHARS);
        logger.info(`[contract-v2-text-section] Record ${record.id}: Split into ${chunks.length} chunks`);

        const chunkResults = [];
        for (let i = 0; i < chunks.length; i++) {
          try {
            const hint = i === 0 ? '这是文档前半部分' : `这是文档第 ${i + 1} 段（共 ${chunks.length} 段）`;
            const response = await services.callLlm('analyze_sections_chunk', {
              instruction: promptBase + `\n\n注意：${hint}`,
              ocr_text: chunks[i],
              response_format: 'json',
              model_id: sectionConfig.model_id,
              temperature: sectionConfig.temperature || 0.3,
            });
            const parsed = parseLlmResponse(response);
            if (Array.isArray(parsed)) chunkResults.push(parsed);
          } catch (chunkErr) {
            logger.warn(`[contract-v2-text-section] Chunk ${i + 1} failed: ${chunkErr.message}`);
          }
        }

        sections = mergeSections(chunkResults);
      }

      if (!Array.isArray(sections)) {
        return { success: false, error: 'Sections must be an array' };
      }

      logger.info(`[contract-v2-text-section] Record ${record.id}: Found ${sections.length} sections`);

      await services.callExtension(CONTENT_TABLE, 'upsert', {
        row_id: record.id,
        sections: JSON.stringify(sections),
      });

      return {
        success: true,
        data: {
          _section_done: true,
        },
      };
    } catch (e) {
      logger.error(`[contract-v2-text-section] Record ${record.id}: ${e.message}`);
      return { success: false, error: 'Section analysis failed: ' + e.message };
    }
  },
};
