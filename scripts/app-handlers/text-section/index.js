import logger from '../../../lib/logger.js';

const DEFAULT_SECTION_CONFIG = {
  type: 'internal_llm',
  model_id: null,
  temperature: 0.3,
};

function getSectionConfig(app, stateName) {
  let config = app?.config;
  if (typeof config === 'string') {
    try { config = JSON.parse(config); } catch { config = {}; }
  }
  return config?.step_resources?.[stateName] || config?.step_resources?.pending_section || DEFAULT_SECTION_CONFIG;
}

function getExtensionTables(app) {
  let config = app?.config || app?.manifest;
  if (typeof config === 'string') {
    try { config = JSON.parse(config); } catch { config = {}; }
  }
  return config?.extension_tables || [];
}

const SECTION_FORMAT_SUFFIX = `

**严格要求：返回完整、合法的 JSON，不能有任何语法错误！**

返回格式示例：
{
  "sections": [
    {
      "id": "sec-1",
      "title": "质量协议",
      "type": "title",
      "level": 1,
      "start_line": 0,
      "end_line": 10
    }
  ]
}

字段说明：
- id: 章节唯一标识（sec-1, sec-2...）
- title: 章节标题（必须填写，从原文提取）
- type: 节点类型（title/party/clause/attachment/other）
- level: 层级数字（1=顶级，2=子条款，3=更细）
- start_line: 起始行号（整数，从0开始）
- end_line: 结束行号（整数，必须大于start_line）

关键规则：
1. 所有字段都必须有值，不能有空值或缺失
2. start_line 和 end_line 必须是整数
3. 前后节点的行号范围不能重叠，要连续覆盖全文
4. 如果某个区域没有明确标题，用"其他内容"作为title
5. 返回值必须是合法JSON，外层结构为 { "sections": [...] }，不能是裸数组
6. end_line 是包含的（inclusive），即该章节最后一行的行号
7. start_line 从0开始计数`;

const SECTION_PROMPT = `分析以下合同文档内容，提取文档结构。

文档类型：合同/协议类文档

请识别以下类型的结构节点：
1. **标题区**：合同名称、版本、编号等基本信息
2. **当事人区**：甲方、乙方等信息
3. **正文条款**：按条款编号分割（如"第一条"、"第1条"、"1."、"一、"等）
4. **附件区**：附件清单、附件内容
${SECTION_FORMAT_SUFFIX}

文档内容（按行编号）：
{{TEXT}}
`;

function getSectionPrompt(app) {
  let config = app?.config;
  if (typeof config === 'string') {
    try { config = JSON.parse(config); } catch { config = {}; }
  }
  return config?.prompts?.section || SECTION_PROMPT;
}

export const availableOutputs = [
  { key: 'sections', label: '章节结构JSON', type: 'string' },
];

export default {
  availableOutputs,
  
  async process(context) {
    const { record, services, app, stateName } = context;
    
    logger.info(`[text-section] Processing record ${record.id}`);
    
    const extTables = getExtensionTables(app);
    const contentConfig = extTables.find(t => t.type === 'content');
    
    let filteredText = '';
    
    if (contentConfig && services.callExtension) {
      const contentRow = await services.callExtension(contentConfig.name, 'read', {
        row_id: record.id,
        fields: ['filtered_text']
      });
      filteredText = contentRow?.filtered_text || '';
    }
    
    if (!filteredText) {
      const data = record.data || {};
      filteredText = data._filtered_text || data._ocr_text || '';
    }
    
    if (!filteredText) {
      logger.error(`[text-section] Record ${record.id}: No filtered_text found`);
      return { success: false, error: 'No filtered_text found' };
    }
    
    const sectionConfig = getSectionConfig(app, stateName || 'pending_section');
    const userPrompt = getSectionPrompt(app);
    const sectionPrompt = userPrompt + SECTION_FORMAT_SUFFIX;

    logger.info(`[text-section] Record ${record.id}: Prompt="${sectionPrompt.substring(0, 200)}${sectionPrompt.length > 200 ? '...' : ''}"`);
    
    const prompt = sectionPrompt.includes('{{TEXT}}') ? sectionPrompt.replace('{{TEXT}}', filteredText) : sectionPrompt + '\n\n文档内容（按行编号）：\n' + filteredText;
    
    try {
      logger.info(`[text-section] Record ${record.id}: Calling LLM for section analysis (text length: ${filteredText.length})`);
      
      const response = await services.callLlm('analyze_sections', {
        instruction: prompt,
        response_format: 'json',
        model_id: sectionConfig.model_id,
        temperature: sectionConfig.temperature || 0.3,
      });
      
      let sections = [];
      try {
        const parsed = JSON.parse(response.text);
        sections = parsed.sections || [];
      } catch {
        const jsonMatch = response.text.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          sections = parsed.sections || [];
        }
      }
      
      logger.info(`[text-section] Record ${record.id}: Found ${sections.length} sections, response preview="${response.text.substring(0, 200).replace(/\n/g, '\\n')}"`);
      
      if (contentConfig && services.callExtension) {
        logger.info(`[text-section] Record ${record.id}: Upserting sections to ${contentConfig.name}`);
        await services.callExtension(contentConfig.name, 'upsert', {
          row_id: record.id,
          sections: JSON.stringify(sections),
        });
      }
      
      logger.info(`[text-section] Record ${record.id}: Section analysis complete`);
      return {
        success: true,
        data: {
          _section_count: sections.length,
        },
      };
      
    } catch (e) {
      logger.error(`[text-section] Record ${record.id}: Section analysis failed - ${e.message}`);
      return { success: false, error: 'Section analysis failed: ' + e.message };
    }
  },
};