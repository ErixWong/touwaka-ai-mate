/**
 * 桥接层：主工程 → app 内实现
 *
 * 真实业务实现位于 apps/current-feature-analyzer/server/services/
 * 本文件仅作为 barrel export 保留，以确保历史 import 不受影响。
 */
export { default as ConfigService } from '../../../apps/current-feature-analyzer/server/services/config.service.js';
export { default as RuleSetService } from '../../../apps/current-feature-analyzer/server/services/rule-set.service.js';
export { default as UploadSessionService } from '../../../apps/current-feature-analyzer/server/services/upload-session.service.js';
export { default as CsvParseService } from '../../../apps/current-feature-analyzer/server/services/csv-parse.service.js';
export { default as VectorCompressionService } from '../../../apps/current-feature-analyzer/server/services/vector-compression.service.js';
export { default as StageRecognitionWorkflowService } from '../../../apps/current-feature-analyzer/server/services/stage-recognition-workflow.service.js';
export { default as LlmStageRecognitionService } from '../../../apps/current-feature-analyzer/server/services/stage-recognition-workflow.service.js';
export { default as StageMetricsService } from '../../../apps/current-feature-analyzer/server/services/stage-metrics.service.js';
export { default as ReportExportService } from '../../../apps/current-feature-analyzer/server/services/report-export.service.js';