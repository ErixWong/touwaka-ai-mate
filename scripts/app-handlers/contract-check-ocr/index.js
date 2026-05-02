import logger from '../../../lib/logger.js';

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
  return mcpResult.content || mcpResult.text || mcpResult.output || mcpResult.markdown || mcpResult.result || '';
}

function truncateTaskInfo(mcpResult, maxLen = 1000) {
  const jsonStr = JSON.stringify(mcpResult, null, 2);
  if (jsonStr.length <= maxLen) {
    return jsonStr;
  }
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

    logger.info(`[contract-check-ocr] Processing record ${record.id}`);

    const data = record.data || {};
    const taskId = data._ocr_task_id;
    if (!taskId) {
      logger.error(`[contract-check-ocr] Record ${record.id}: No OCR task_id found`);
      return { success: false, error: 'No OCR task_id found' };
    }

    logger.info(`[contract-check-ocr] Record ${record.id}: Task ID ${taskId}`);

    const resConfig = getConfig(app, stateName || 'ocr_submitted');
    const mcp = resConfig.mcp || {};

    try {
      logger.info(`[contract-check-ocr] Record ${record.id}: Calling MCP ${mcp.server}.${mcp.tool || 'get_task'}`);
      const mcpResult = await services.callMcp(mcp.server, mcp.tool || 'get_task', { task_id: taskId });
      
      logger.info(`[contract-check-ocr] Record ${record.id}: MCP result received, judging status`);
      
      // ✅ 截取前1000字符避免token超限
      const taskInfo = truncateTaskInfo(mcpResult, 1000);
      logger.info(`[contract-check-ocr] Record ${record.id}: Task info length=${taskInfo.length}`);
      
      const judgeResult = await services.callLlm('judge_ocr_status', {
        instruction: JUDGE_PROMPT.replace('{{TASK_INFO}}', taskInfo),
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

      logger.info(`[contract-check-ocr] Record ${record.id}: Judge result - status=${parsed.status}, progress=${parsed.progress}`);

      if (parsed.status === 'completed') {
        const ocrText = extractTextFromMcpResult(mcpResult);
        logger.info(`[contract-check-ocr] Record ${record.id}: OCR completed, text length=${ocrText.length}`);
        
        await services.callExtension('app_contract_mgr_content', 'upsert', {
          row_id: record.id,
          ocr_text: ocrText,
        });
        
        logger.info(`[contract-check-ocr] Record ${record.id}: OCR text saved to extension table`);
        
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
        logger.info(`[contract-check-ocr] Record ${record.id}: OCR pending, progress=${parsed.progress}`);
        return {
          success: true,
          pending: true,
          data: {
            _ocr_status: 'processing',
            _ocr_progress: parsed.progress || 0,
          },
        };
      }

      logger.error(`[contract-check-ocr] Record ${record.id}: OCR failed - ${parsed.reason}`);
      return {
        success: false,
        error: 'OCR task failed: ' + parsed.reason,
      };
    } catch (e) {
      logger.error(`[contract-check-ocr] Record ${record.id}: Check OCR status failed - ${e.message}`);
      return { success: false, error: 'Check OCR status failed: ' + e.message };
    }
  },
};