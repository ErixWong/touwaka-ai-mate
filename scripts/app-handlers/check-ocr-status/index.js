import logger from '../../../lib/logger.js';

const DEFAULT_STEP_RESOURCES = {
  type: 'mcp',
  mcp: { server: 'markitdown', tool: 'get_task' },
  judge_model_id: 'gpt-4o-mini',  // 使用轻量级模型做状态判断
  judge_temperature: 0.1,
};

const JUDGE_PROMPT = `
你是 OCR 任务状态判断器。

分析以下 MCP 服务返回结果，判断任务当前状态。

返回数据：
{{MCP_RESULT}}

请只返回 JSON 格式，不要其他内容：
{
  "status": "completed" 或 "pending" 或 "failed",
  "progress": 0-100 的数字,
  "reason": "判断理由（简短）"
}

状态定义：
- completed: 任务已完成，有结果内容
- pending: 任务正在进行、排队中或等待处理
- failed: 任务失败、出错或被取消

注意：只返回 JSON，不要任何其他文字。
`;

export const availableOutputs = [
  { key: 'task_id', label: 'OCR任务ID', type: 'string' },
];

function getConfig(app, stateName) {
  let config = app?.config;
  if (typeof config === 'string') {
    try { config = JSON.parse(config); } catch { config = {}; }
  }
  return config?.step_resources?.[stateName] || DEFAULT_STEP_RESOURCES;
}

function extractTextFromMcpResult(mcpResult) {
  return mcpResult.content || mcpResult.text || mcpResult.output || mcpResult.markdown || mcpResult.result || '';
}

export default {
  availableOutputs,
  async process(context) {
    const { record, services, app, stateName } = context;

    logger.info(`[check-ocr] Processing record ${record.id}`);

    const data = record.data || {};
    const taskId = data._ocr_task_id;
    if (!taskId) {
      logger.error(`[check-ocr] Record ${record.id}: No OCR task_id found`);
      return { success: false, error: 'No OCR task_id found' };
    }

    logger.info(`[check-ocr] Record ${record.id}: Task ID ${taskId}`);

    const resConfig = getConfig(app, stateName || 'ocr_submitted');
    const mcp = resConfig.mcp || {};

    try {
      logger.info(`[check-ocr] Record ${record.id}: Calling MCP ${mcp.server}.${mcp.tool || 'get_task'}`);
      const mcpResult = await services.callMcp(mcp.server, mcp.tool || 'get_task', { task_id: taskId });
      
      logger.info(`[check-ocr] Record ${record.id}: MCP result received, judging status`);
      const judgeResult = await services.callLlm('judge_ocr_status', {
        instruction: JUDGE_PROMPT.replace('{{MCP_RESULT}}', JSON.stringify(mcpResult, null, 2)),
        model_id: resConfig.judge_model_id,
        temperature: resConfig.judge_temperature || 0.1,
        response_format: 'json',
      });

      let parsed;
      try {
        const jsonMatch = judgeResult.text.match(/\{[\s\S]*\}/);
        parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : { status: 'pending', progress: 0, reason: 'Parse failed' };
      } catch {
        parsed = { status: 'pending', progress: 0, reason: 'JSON parse error' };
      }

      logger.info(`[check-ocr] Record ${record.id}: Judge result - status=${parsed.status}, progress=${parsed.progress}, reason=${parsed.reason}`);

      if (parsed.status === 'completed') {
        const ocrText = extractTextFromMcpResult(mcpResult);
        logger.info(`[check-ocr] Record ${record.id}: OCR completed, text length=${ocrText.length}`);
        return {
          success: true,
          data: {
            _ocr_text: ocrText,
            _ocr_status: 'completed',
            _ocr_progress: 100,
            _ocr_completed_at: new Date().toISOString(),
            _judge_reason: parsed.reason,
          },
        };
      }

      if (parsed.status === 'pending') {
        logger.info(`[check-ocr] Record ${record.id}: OCR pending, progress=${parsed.progress}`);
        return {
          success: true,
          pending: true,
          data: {
            _ocr_status: 'processing',
            _ocr_progress: parsed.progress || 0,
            _judge_reason: parsed.reason,
          },
        };
      }

      logger.error(`[check-ocr] Record ${record.id}: OCR failed - ${parsed.reason}`);
      return {
        success: false,
        error: 'OCR task failed: ' + parsed.reason,
      };
    } catch (e) {
      logger.error(`[check-ocr] Record ${record.id}: Check OCR status failed - ${e.message}`);
      return { success: false, error: 'Check OCR status failed: ' + e.message };
    }
  },
};