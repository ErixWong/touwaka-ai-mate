import logger from '../../../lib/logger.js';
import {
  BATCH_STATUS,
  FILE_ANALYSIS_STATUS,
} from '../states.js';
import {
  ConfigService,
  RuleSetService,
  UploadSessionService,
  CsvParseService,
  VectorCompressionService,
  LlmStageRecognitionService,
  StageMetricsService,
  ReportExportService,
} from './services/index.js';

class CurrentFeatureAnalyzerController {
  constructor(db) {
    this.db = db;
    this.configService = new ConfigService(db);
    this.ruleSetService = new RuleSetService(db);
    this.uploadSessionService = new UploadSessionService(db);
    this.csvParseService = new CsvParseService(db);
    this.vectorCompressionService = new VectorCompressionService(db);
    this.llmStageRecognitionService = new LlmStageRecognitionService(db);
    this.stageMetricsService = new StageMetricsService(db);
    this.reportExportService = new ReportExportService(db);
  }

  getUserId(ctx) {
    return ctx.state.session?.id || ctx.state.user?.id || null;
  }

  async upload(ctx) {
    try {
      const userId = this.getUserId(ctx);
      if (!userId) { ctx.error('Unauthorized', 401); return; }

      // multer 将文件放在 ctx.files 中
      const files = ctx.files?.files || ctx.request.files?.files;
      if (!files || files.length === 0) {
        ctx.error('请至少上传一个 CSV 文件', 400);
        return;
      }

      const fileList = Array.isArray(files) ? files : [files];
      const batch = this.uploadSessionService.createBatch(
        fileList.map(f => f.originalname || f.originalFilename || f.name || 'unknown.csv'),
        userId
      );

      for (let i = 0; i < fileList.length; i++) {
        const f = fileList[i];
        try {
          const text = this.readUploadedFileSync(f);
          const parsed = this.csvParseService.parse(text);

          if (parsed.error) {
            this.uploadSessionService.setFileError(batch.batch_id, batch.files[i].file_id, parsed.error);
            continue;
          }

          this.uploadSessionService.setFileRawData(
            batch.batch_id, batch.files[i].file_id, parsed.points, {
              row_count: parsed.point_count,
              time_column: parsed.time_column,
              current_column: parsed.current_column,
              file_size: f.size || 0,
            }
          );

          if (parsed.duplicate_diagnosis) {
            const file = this.uploadSessionService.getBatch(batch.batch_id).files[i];
            file._duplicate_diagnosis = parsed.duplicate_diagnosis;
          }
        } catch (fileErr) {
          logger.error(`[cfa controller] file parse error for ${f.originalname || f.name}:`, fileErr.message);
          this.uploadSessionService.setFileError(batch.batch_id, batch.files[i].file_id, fileErr.message);
        }
      }

      const updated = this.uploadSessionService.getBatch(batch.batch_id);
      ctx.success(updated);
    } catch (err) {
      logger.error('[cfa controller] upload error:', err.message);
      ctx.error(err.message, 500);
    }
  }

  readUploadedFileSync(f) {
    // multer memoryStorage → f.buffer
    if (f.buffer) {
      return f.buffer.toString('utf-8');
    }
    // data URL / raw data
    if (f.data) {
      return typeof f.data === 'string' ? f.data : f.data.toString('utf-8');
    }
    throw new Error('无法读取上传文件：仅支持内存存储模式');
  }

  async getBatch(ctx) {
    try {
      const userId = this.getUserId(ctx);
      if (!userId) { ctx.error('Unauthorized', 401); return; }
      const { batch_id } = ctx.params;
      const batch = this.uploadSessionService.getBatch(batch_id);
      if (!batch) { ctx.error('批次不存在或已过期', 404); return; }
      if (!this.uploadSessionService.isBatchOwner(batch_id, userId)) {
        ctx.error('无权访问该批次', 403); return;
      }
      // 轻量模式：轮询接口剥离 raw_data，减少带宽与暴露面
      // 完整数据（含 raw_data / result）通过 getFileDetail 按需获取
      const lightBatch = {
        ...batch,
        files: batch.files.map(f => {
          const { raw_data, result, ...rest } = f;
          return rest;
        }),
      };
      ctx.success(lightBatch);
    } catch (err) {
      logger.error('[cfa controller] getBatch error:', err.message);
      ctx.error(err.message, 500);
    }
  }

  async getFileDetail(ctx) {
    try {
      const userId = this.getUserId(ctx);
      if (!userId) { ctx.error('Unauthorized', 401); return; }
      const { batch_id, file_id } = ctx.params;
      const batch = this.uploadSessionService.getBatch(batch_id);
      if (!batch) { ctx.error('批次不存在或已过期', 404); return; }
      if (!this.uploadSessionService.isBatchOwner(batch_id, userId)) {
        ctx.error('无权访问该批次', 403); return;
      }
      const file = batch.files.find(f => f.file_id === file_id);
      if (!file) { ctx.error('文件不存在', 404); return; }
      ctx.success(file);
    } catch (err) {
      logger.error('[cfa controller] getFileDetail error:', err.message);
      ctx.error(err.message, 500);
    }
  }

  async runAnalysis(ctx) {
    try {
      const userId = this.getUserId(ctx);
      if (!userId) { ctx.error('Unauthorized', 401); return; }
      const { batch_id, rule_set_id, analysis_options } = ctx.request.body || {};
      if (!batch_id) { ctx.error('batch_id is required', 400); return; }

      const batch = this.uploadSessionService.getBatch(batch_id);
      if (!batch) { ctx.error('批次不存在或已过期', 404); return; }
      if (!this.uploadSessionService.isBatchOwner(batch_id, userId)) {
        ctx.error('无权访问该批次', 403); return;
      }

      // 防重：已在分析中的批次禁止重复启动
      if (batch.batch_status === BATCH_STATUS.ANALYZING) {
        ctx.error('分析已在进行中，请等待完成', 409); return;
      }

      const ruleSetId = rule_set_id || batch.selected_rule_set_id;
      if (!ruleSetId) { ctx.error('请先选择规则集', 400); return; }

      const ruleSet = await this.ruleSetService.getById(ruleSetId, true);
      if (!ruleSet) { ctx.error('规则集不存在', 404); return; }

      const appConfig = await this.configService.getConfig();
      const vcOptions = {
        absolute_resolution: analysis_options?.absolute_resolution ?? appConfig.absolute_resolution,
        relative_resolution: analysis_options?.relative_resolution ?? appConfig.relative_resolution,
        merge_gap_ratio: analysis_options?.merge_gap_ratio ?? appConfig.merge_gap_ratio,
        min_transition_points: analysis_options?.min_transition_points ?? appConfig.min_transition_points,
      };

      this.uploadSessionService.setBatchStatus(batch_id, BATCH_STATUS.ANALYZING);

      // 立即返回，实际分析在后台执行
      ctx.success(this.uploadSessionService.getBatch(batch_id));

      // 后台异步执行分析
      this._runAnalysisInBackground(batch_id, ruleSet, appConfig, vcOptions);
    } catch (err) {
      logger.error('[cfa controller] runAnalysis error:', err.message);
      ctx.error(err.message, 500);
    }
  }

  async _runAnalysisInBackground(batch_id, ruleSet, appConfig, vcOptions) {
    try {
      const batch = this.uploadSessionService.getBatch(batch_id);
      if (!batch) return;

      for (const file of batch.files) {
        if (!file.raw_data || file.analysis_status === FILE_ANALYSIS_STATUS.FAILED) continue;

        try {
          this.uploadSessionService.setFileStatus(batch_id, file.file_id, FILE_ANALYSIS_STATUS.ANALYZING);

          const compressionResult = this.vectorCompressionService.compress(file.raw_data, vcOptions);

          // 压缩完成立即推送 segments/globals，前端轮询可立即显示图表
          this.uploadSessionService.setFileResult(batch_id, file.file_id, {
            globals: compressionResult.globals,
            segments: compressionResult.segments,
            events: compressionResult.events,
            llm_result: { stages: [], warnings: [{ message: '分析中...' }] },
            stage_metrics: [],
            file_metrics: null,
          });

          const llmResult = await this.llmStageRecognitionService.recognize(
            compressionResult.globals,
            compressionResult.segments,
            compressionResult.events,
            ruleSet,
            appConfig
          );

          const stageMetrics = this.stageMetricsService.calculate(file.raw_data, llmResult);
          const fileMetrics = this.stageMetricsService.buildFileMetrics(
            file.raw_data, compressionResult.segments, stageMetrics, llmResult
          );

          this.uploadSessionService.setFileResult(batch_id, file.file_id, {
            globals: compressionResult.globals,
            segments: compressionResult.segments,
            events: compressionResult.events,
            llm_result: llmResult,
            stage_metrics: stageMetrics,
            file_metrics: fileMetrics,
          });
          this.uploadSessionService.setFileStatus(batch_id, file.file_id, FILE_ANALYSIS_STATUS.COMPLETED);
        } catch (err) {
          logger.error(`[cfa controller] analysis error for file ${file.file_name}:`, err.message);
          this.uploadSessionService.setFileError(batch_id, file.file_id, err.message);
        }
      }

      // 唯一决策点：通过 buildSummary 归约批次终态
      this.uploadSessionService.buildSummary(batch_id);
    } catch (err) {
      logger.error('[cfa controller] background analysis error:', err.message);
      // 仅在批次尚未进入终态时写入 FAILED，避免覆盖已有的终态结果
      const current = this.uploadSessionService.getBatch(batch_id);
      if (current && current.batch_status !== BATCH_STATUS.COMPLETED
          && current.batch_status !== BATCH_STATUS.PARTIAL_FAILED
          && current.batch_status !== BATCH_STATUS.FAILED) {
        this.uploadSessionService.setBatchStatus(batch_id, BATCH_STATUS.FAILED);
      } else if (current) {
        logger.warn(`[cfa controller] batch ${batch_id} already terminal (${current.batch_status}), skipping FAILED override`);
      }
    }
  }

  async getReport(ctx) {
    try {
      const userId = this.getUserId(ctx);
      if (!userId) { ctx.error('Unauthorized', 401); return; }
      const { batch_id } = ctx.params;
      const batch = this.uploadSessionService.getBatch(batch_id);
      if (!batch) { ctx.error('批次不存在或已过期', 404); return; }
      if (!this.uploadSessionService.isBatchOwner(batch_id, userId)) {
        ctx.error('无权访问该批次', 403); return;
      }
      ctx.success(batch);
    } catch (err) {
      logger.error('[cfa controller] getReport error:', err.message);
      ctx.error(err.message, 500);
    }
  }

  async exportReport(ctx) {
    try {
      const userId = this.getUserId(ctx);
      if (!userId) { ctx.error('Unauthorized', 401); return; }
      const { batch_id } = ctx.params;
      const batch = this.uploadSessionService.getBatch(batch_id);
      if (!batch) { ctx.error('批次不存在或已过期', 404); return; }
      if (!this.uploadSessionService.isBatchOwner(batch_id, userId)) {
        ctx.error('无权访问该批次', 403); return;
      }

      const { stageDetailRows, summaryRows } = this.reportExportService.buildExcelData(batch);

      // 按需动态导入 xlsx，避免顶层强依赖影响服务启动
      let XLSX;
      try {
        XLSX = await import('xlsx');
      } catch (_) {
        logger.error('[cfa controller] xlsx module not available for export');
        ctx.error('导出功能暂不可用，请联系管理员安装 xlsx 依赖', 503);
        return;
      }

      const wb = XLSX.utils.book_new();
      const detailWs = XLSX.utils.json_to_sheet(stageDetailRows);
      const summaryWs = XLSX.utils.json_to_sheet(summaryRows);
      XLSX.utils.book_append_sheet(wb, detailWs, 'stage_detail');
      XLSX.utils.book_append_sheet(wb, summaryWs, 'summary');

      const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

      ctx.set('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      ctx.set(
        'Content-Disposition',
        `attachment; filename="current-feature-analysis-${new Date().toISOString().replace(/[:.]/g, '-')}.xlsx"`
      );
      ctx.body = buffer;
    } catch (err) {
      logger.error('[cfa controller] exportReport error:', err.message);
      ctx.error(err.message, 500);
    }
  }

  async listRuleSets(ctx) {
    try {
      const userId = this.getUserId(ctx);
      if (!userId) { ctx.error('Unauthorized', 401); return; }
      const sets = await this.ruleSetService.list();
      ctx.success({ items: sets });
    } catch (err) {
      logger.error('[cfa controller] listRuleSets error:', err.message);
      ctx.error(err.message, 500);
    }
  }

  async getRuleSet(ctx) {
    try {
      const userId = this.getUserId(ctx);
      if (!userId) { ctx.error('Unauthorized', 401); return; }
      const { id } = ctx.params;
      const ruleSet = await this.ruleSetService.getById(id, true);
      if (!ruleSet) { ctx.error('规则集不存在', 404); return; }

      if (ruleSet.is_default !== undefined && ruleSet.is_default.length !== undefined) {
        ruleSet.is_default = !!ruleSet.is_default[0];
      }
      if (ruleSet.is_enabled !== undefined && ruleSet.is_enabled.length !== undefined) {
        ruleSet.is_enabled = !!ruleSet.is_enabled[0];
      }

      ctx.success(ruleSet);
    } catch (err) {
      logger.error('[cfa controller] getRuleSet error:', err.message);
      ctx.error(err.message, 500);
    }
  }

  async createRuleSet(ctx) {
    try {
      const userId = this.getUserId(ctx);
      if (!userId) { ctx.error('Unauthorized', 401); return; }
      const data = ctx.request.body || {};
      const ruleSet = await this.ruleSetService.create(data, userId);
      ctx.success(ruleSet);
    } catch (err) {
      logger.error('[cfa controller] createRuleSet error:', err.message);
      ctx.error(err.message, 500);
    }
  }

  async updateRuleSet(ctx) {
    try {
      const userId = this.getUserId(ctx);
      if (!userId) { ctx.error('Unauthorized', 401); return; }
      const { id } = ctx.params;
      const data = ctx.request.body || {};
      const ruleSet = await this.ruleSetService.update(id, data, userId);
      ctx.success(ruleSet);
    } catch (err) {
      logger.error('[cfa controller] updateRuleSet error:', err.message);
      ctx.error(err.message, 500);
    }
  }

  async deleteRuleSet(ctx) {
    try {
      const userId = this.getUserId(ctx);
      if (!userId) { ctx.error('Unauthorized', 401); return; }
      const { id } = ctx.params;
      await this.ruleSetService.remove(id);
      ctx.success({ deleted: true });
    } catch (err) {
      logger.error('[cfa controller] deleteRuleSet error:', err.message);
      ctx.error(err.message, 500);
    }
  }

  async copyRuleSet(ctx) {
    try {
      const userId = this.getUserId(ctx);
      if (!userId) { ctx.error('Unauthorized', 401); return; }
      const { id } = ctx.params;
      const ruleSet = await this.ruleSetService.copy(id, userId);
      ctx.success(ruleSet);
    } catch (err) {
      logger.error('[cfa controller] copyRuleSet error:', err.message);
      ctx.error(err.message, 500);
    }
  }

  async getConfig(ctx) {
    try {
      const userId = this.getUserId(ctx);
      if (!userId) { ctx.error('Unauthorized', 401); return; }
      const config = await this.configService.getConfig();
      ctx.success(config);
    } catch (err) {
      logger.error('[cfa controller] getConfig error:', err.message);
      ctx.error(err.message, 500);
    }
  }

  async saveConfig(ctx) {
    try {
      const userId = this.getUserId(ctx);
      if (!userId) { ctx.error('Unauthorized', 401); return; }
      const config = ctx.request.body || {};
      const saved = await this.configService.saveConfig(config);
      ctx.success(saved);
    } catch (err) {
      logger.error('[cfa controller] saveConfig error:', err.message);
      ctx.error(err.message, 500);
    }
  }
}

export default CurrentFeatureAnalyzerController;
