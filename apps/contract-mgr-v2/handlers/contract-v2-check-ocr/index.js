import logger from '../../../../lib/logger.js';

const JUDGE_PROMPT = `判断OCR任务是否完成。

任务返回信息（截取前1000字符）：
{{TASK_INFO}}

请返回JSON格式：
{
  "status": "completed|pending|failed",
  "progress": 0-100,
  "reason": "判断原因"
}`;

function getConfig(app, stateName) {
  let config = app?.config;
  if (typeof config === 'string') {
    try { config = JSON.parse(config); } catch { config = {}; }
  }
  return config?.step_resources?.[stateName] || config?.step_resources?.ocr_submitted || {};
}

function extractTextFromMcpResult(mcpResult) {
  if (!mcpResult) return '';
  if (typeof mcpResult === 'string') return mcpResult;
  const r = mcpResult.result;
  if (typeof r === 'string') return r;
  const content = mcpResult.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    const texts = content.filter(c => c.type === 'text').map(c => c.text);
    if (texts.length) return texts.join('\n');
  }
  return mcpResult.text || mcpResult.output || mcpResult.markdown || '';
}

function truncateTaskInfo(mcpResult, maxLen = 1000) {
  if (mcpResult == null) return '(no result)';
  const jsonStr = JSON.stringify(mcpResult, null, 2);
  if (!jsonStr || jsonStr.length <= maxLen) return jsonStr || '(empty)';
  return jsonStr.substring(0, maxLen) + '\n... (截取前' + maxLen + '字符)';
}

export const availableOutputs = [
  { key: 'ocr_status', label: 'OCR状态', type: 'string' },
  { key: 'ocr_progress', label: 'OCR进度', type: 'number' },
];

export default {
  availableOutputs,
  async process(context) {
    const { record, services, app, stateName } = context;

    logger.info(`[contract-v2-check-ocr] Processing record ${record.id}`);

    const data = record.data || {};
    const taskId = data._ocr_task_id;
    if (!taskId) {
      logger.error(`[contract-v2-check-ocr] Record ${record.id}: No OCR task_id found`);
      return { success: false, error: 'No OCR task_id found' };
    }

    const resConfig = getConfig(app, stateName || 'ocr_submitted');
    const mcp = resConfig.mcp || {};

    try {
      const mcpResult = await services.callMcp(mcp.server, mcp.tool || 'get_task', { task_id: taskId });
      const taskInfo = truncateTaskInfo(mcpResult, 1000);

      const judgeResult = await services.callLlm('judge_ocr_status', {
        instruction: JUDGE_PROMPT.replace('{{TASK_INFO}}', taskInfo),
        model_id: resConfig.judge_model_id,
        temperature: resConfig.judge_temperature || 0.1,
        response_format: 'json',
        enable_thinking: false,
      });

      let parsed;
      try {
        const jsonMatch = judgeResult.text.match(/\{[\s\S]*\}/);
        parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : { status: 'pending', progress: 0, reason: 'Parse failed' };
      } catch {
        parsed = { status: 'pending', progress: 0, reason: 'JSON parse error' };
      }

      if (parsed.status === 'completed') {
        const ocrText = extractTextFromMcpResult(mcpResult);
        logger.info(`[contract-v2-check-ocr] Record ${record.id}: OCR completed, text length=${ocrText.length}`);

        await services.callExtension('app_contract_mgr_v2_content', 'upsert', {
          row_id: record.id,
          ocr_text: ocrText,
          ocr_service: mcp.server || 'markitdown',
          ocr_at: new Date(),
        });

        return {
          success: true,
          data: {
            _ocr_done: true,
            _ocr_status: 'completed',
            _ocr_progress: 100,
          },
        };
      }

      if (parsed.status === 'pending') {
        return {
          success: true,
          pending: true,
          data: {
            _ocr_status: 'processing',
            _ocr_progress: parsed.progress || 0,
          },
        };
      }

      return { success: false, error: 'OCR task failed: ' + parsed.reason };
    } catch (e) {
      logger.error(`[contract-v2-check-ocr] Record ${record.id}: ${e.message}`);
      return { success: false, error: 'Check OCR status failed: ' + e.message };
    }
  },
};
