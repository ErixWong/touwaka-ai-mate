import logger from '../../../lib/logger.js';

const CONTENT_TABLE = 'app_contract_v2_content';

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

    let config = app?.config;
    if (typeof config === 'string') {
      try { config = JSON.parse(config); } catch { config = {}; }
    }
    const sectionConfig = config?.step_resources?.pending_section || { type: 'internal_llm', temperature: 0.3 };
    const sectionPrompt = config?.prompts?.section || null;

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
      const response = await services.callLlm('analyze_sections', {
        instruction: promptBase,
        ocr_text: content.filtered_text,
        response_format: 'json',
        model_id: sectionConfig.model_id,
        temperature: sectionConfig.temperature || 0.3,
      });

      let sections;
      const resultText = response.text || response.parsed || response;
      if (typeof resultText === 'string') {
        const jsonMatch = resultText.match(/\{[\s\S]*\}/);
        if (!jsonMatch) return { success: false, error: 'LLM did not return valid JSON' };
        const parsed = JSON.parse(jsonMatch[0]);
        sections = parsed.sections || parsed;
      } else if (typeof resultText === 'object') {
        sections = resultText.sections || resultText;
      } else {
        return { success: false, error: 'LLM returned unexpected format' };
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
