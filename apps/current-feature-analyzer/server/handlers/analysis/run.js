import {
  UploadSessionService,
  StageRecognitionWorkflowService,
  StageMetricsService,
  ConfigService,
  RuleSetService,
} from '../../services/index.js';
import { BATCH_STATUS, FILE_ANALYSIS_STATUS } from '../../../states.js'

// Handler 元数据：声明具名参数路径
export const route = {
  path: '/analysis/run',
};

function getUserId(ctx) {
  return ctx.state.session?.id || ctx.state.user?.id || null;
}

export async function post(ctx, deps) {
  try {
    const userId = getUserId(ctx);
    if (!userId) { ctx.error('Unauthorized', 401); return; }

    const { batch_id, rule_set_id, file_results } = ctx.request.body || {};
    if (!batch_id) { ctx.error('batch_id is required', 400); return; }
    if (!Array.isArray(file_results) || file_results.length === 0) {
      ctx.error('file_results is required', 400)
      return
    }

    const uploadSessionService = new UploadSessionService(deps.db);
    const batch = uploadSessionService.getBatch(batch_id);

    if (!batch) { ctx.error('批次不存在或已过期', 404); return; }
    if (!uploadSessionService.isBatchOwner(batch_id, userId)) {
      ctx.error('无权访问该批次', 403);
      return;
    }

    if (batch.batch_status !== BATCH_STATUS.READY) {
      ctx.error('批次当前状态不允许启动分析', 400);
      return;
    }

    const stageRecognitionWorkflowService = new StageRecognitionWorkflowService(deps.db)
    const stageMetricsService = new StageMetricsService(deps.db)
    const configService = new ConfigService(deps.db)
    const ruleSetService = new RuleSetService(deps.db)

    uploadSessionService.setSelectedRuleSet(batch_id, rule_set_id);

    const appConfig = await configService.getConfig()
    const ruleSet = await ruleSetService.getById(rule_set_id, true)
    if (!ruleSet) {
      ctx.error('规则集不存在', 404)
      return
    }

    uploadSessionService.setBatchStatus(batch_id, BATCH_STATUS.ANALYZING)

    const resultMap = new Map(file_results.map(item => [item.file_id, item]))
    for (const file of batch.files) {
      const localResult = resultMap.get(file.file_id)
      if (!localResult) {
        if (file.analysis_status === FILE_ANALYSIS_STATUS.FAILED) {
          continue
        }
        uploadSessionService.setFileError(batch_id, file.file_id, '前端未提交该文件的分析结果')
        continue
      }

      const normalizedResult = localResult.result && typeof localResult.result === 'object'
        ? localResult.result
        : null
      const normalizedStatus = localResult.analysis_status === FILE_ANALYSIS_STATUS.FAILED
        ? FILE_ANALYSIS_STATUS.FAILED
        : normalizedResult
          ? FILE_ANALYSIS_STATUS.COMPLETED
          : FILE_ANALYSIS_STATUS.FAILED
      const warningCount = Number.isFinite(Number(localResult.warning_count))
        ? Number(localResult.warning_count)
        : (normalizedResult?.llm_result?.warnings || []).length
      const errorMessage = typeof localResult.error_message === 'string' && localResult.error_message.trim()
        ? localResult.error_message.trim()
        : null

      if (file.analysis_status === FILE_ANALYSIS_STATUS.FAILED && normalizedStatus === FILE_ANALYSIS_STATUS.FAILED) {
        if (errorMessage) {
          file.error_message = errorMessage
        }
        continue
      }

      try {
        if (file.analysis_status === FILE_ANALYSIS_STATUS.PENDING) {
          uploadSessionService.setFileStatus(batch_id, file.file_id, FILE_ANALYSIS_STATUS.READY)
        }
        uploadSessionService.setFileStatus(batch_id, file.file_id, FILE_ANALYSIS_STATUS.ANALYZING)

        if (!normalizedResult) {
          uploadSessionService.setFileError(batch_id, file.file_id, errorMessage || '前端压缩结果缺失')
          continue
        }

        const globals = normalizedResult.globals || {}
        const segments = Array.isArray(normalizedResult.segments) ? normalizedResult.segments : []
        const events = Array.isArray(normalizedResult.events) ? normalizedResult.events : []
        const compressionMeta = normalizedResult.compression_meta && typeof normalizedResult.compression_meta === 'object'
          ? normalizedResult.compression_meta
          : null
        const contour = normalizedResult.contour && typeof normalizedResult.contour === 'object'
          ? normalizedResult.contour
          : null
        const rawData = file.raw_data || []
        const llmResult = await stageRecognitionWorkflowService.recognize(globals, segments, events, ruleSet, appConfig, contour)
        const stageMetrics = stageMetricsService.calculate(rawData, llmResult)
        const fileMetrics = stageMetricsService.buildFileMetrics(rawData, segments, stageMetrics, llmResult)

        uploadSessionService.setFileResult(batch_id, file.file_id, {
          globals,
          segments,
          events,
          compression_meta: compressionMeta,
          contour,
          llm_result: llmResult,
          stage_metrics: stageMetrics,
          file_metrics: fileMetrics,
        })

        file.warning_count = Number.isFinite(Number(warningCount))
          ? warningCount
          : (llmResult.warnings || []).length

        if (normalizedStatus === FILE_ANALYSIS_STATUS.COMPLETED && !llmResult?._error) {
          file.error_message = null
          uploadSessionService.setFileStatus(batch_id, file.file_id, FILE_ANALYSIS_STATUS.COMPLETED)
        } else {
          uploadSessionService.setFileError(batch_id, file.file_id, errorMessage || llmResult?._error || '分析失败')
        }
      } catch (fileErr) {
        uploadSessionService.setFileError(batch_id, file.file_id, fileErr.message)
      }
    }

    const summary = uploadSessionService.buildSummary(batch_id)
    const updatedBatch = uploadSessionService.getBatch(batch_id)
    const lightBatch = {
      batch_id: updatedBatch.batch_id,
      batch_status: updatedBatch.batch_status,
      selected_rule_set_id: updatedBatch.selected_rule_set_id,
      summary,
      files: updatedBatch.files.map(file => {
        const { raw_data, ...rest } = file
        return rest
      }),
    }

    ctx.success(lightBatch);
  } catch (err) {
    ctx.error(err.message, 500);
  }
}
