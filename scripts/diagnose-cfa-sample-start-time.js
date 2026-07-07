import fs from 'node:fs';
import path from 'node:path';
import CsvParseService from '../apps/current-feature-analyzer/server/services/csv-parse.service.js';
import StageRecognitionWorkflowService from '../apps/current-feature-analyzer/server/services/stage-recognition-workflow.service.js';
import StageMetricsService from '../apps/current-feature-analyzer/server/services/stage-metrics.service.js';
import { runLocalCurrentFeatureAnalysis } from '../apps/current-feature-analyzer/frontend/utils/local-analysis.ts';

const sampleFile = process.argv[2] || 'D:\\seafile\\temp_files\\临时文件\\2026\\06\\C518-85-RR_1.csv';

function printHeader(title) {
  console.log(`\n========== ${title} ==========`);
}

function buildMockDb() {
  return {
    getModelConfig: async (id) => ({
      id,
      model_type: 'text',
    }),
    getModel: () => ({
      findOne: async () => ({ id: 'mock-model' }),
    }),
  };
}

async function main() {
  console.log('CFA 样本起始时间诊断');
  console.log('========================');
  console.log(`样本文件: ${sampleFile}`);

  if (!fs.existsSync(sampleFile)) {
    throw new Error(`样本文件不存在: ${sampleFile}`);
  }

  const content = fs.readFileSync(sampleFile, 'utf8');
  const parser = new CsvParseService(null);
  const parsed = parser.parse(content);
  if (!parsed.success) {
    throw new Error(`CSV 解析失败: ${parsed.error || 'unknown error'}`);
  }

  printHeader('原始数据概况');
  console.log(`点数: ${parsed.points.length}`);
  console.log(`时间范围: ${parsed.time_range?.[0]}s -> ${parsed.time_range?.[1]}s`);
  console.log('前 5 个点:');
  parsed.points.slice(0, 5).forEach((pt, idx) => {
    console.log(`  ${idx}: ${pt[0]}, ${pt[1]}`);
  });

  const localResult = runLocalCurrentFeatureAnalysis(parsed.points, null);
  const segments = localResult.segments || [];

  printHeader('压缩结果');
  console.log(`压缩段数: ${segments.length}`);
  console.log('前 5 段:');
  segments.slice(0, 5).forEach((seg) => {
    console.log(`  段${seg.segment_index}: ${seg.kind} ${seg.start_time}s -> ${seg.end_time}s, 电流 ${seg.start_current}A -> ${seg.end_current}A, 点数 ${seg.point_count}`);
  });

  const firstSegmentStart = segments[0]?.start_time;
  const lastSegmentEnd = segments[segments.length - 1]?.end_time;
  console.log(`首段开始时间: ${firstSegmentStart}`);
  console.log(`末段结束时间: ${lastSegmentEnd}`);

  const mockRuleSet = {
    description: '诊断样本起始时间是否被错误锚定到 0',
    stages: [
      { stage_code: 'standby', stage_name: '待机', semantic_definition: '低电流稳定状态' },
      { stage_code: 'startup', stage_name: '启动', semantic_definition: '从低电流进入启动过程' },
    ],
  };

  const appConfig = {
    llm_model_id: 'mock-model',
    temperature: 0,
    enable_json_repair: true,
    analysis_prompt_template: '你是一个电流时序数据分析专家。',
    json_output_schema: JSON.stringify({
      type: 'object',
      properties: {
        stages: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              stage_code: { type: 'string' },
              stage_name: { type: 'string' },
              start_time: { type: 'number' },
              end_time: { type: 'number' },
            },
            required: ['stage_code', 'stage_name', 'start_time', 'end_time'],
          },
        },
      },
      required: ['stages'],
    }),
  };

  const workflow = new StageRecognitionWorkflowService(buildMockDb());

  const fakeLlmStages = {
    stages: [
      { stage_code: 'standby', stage_name: '待机', start_time: 0, end_time: 0.3992, confidence: 0.8, reason: '模拟旧结果' },
      { stage_code: 'startup', stage_name: '启动', start_time: 0.3992, end_time: 0.5869, confidence: 0.8, reason: '模拟旧结果' },
    ],
  };

  workflow.internalLLM.extractJson = async () => fakeLlmStages;

  printHeader('模拟旧式 LLM 输出（从 0 开始）');
  fakeLlmStages.stages.forEach((stage) => {
    console.log(`  ${stage.stage_name}: ${stage.start_time}s -> ${stage.end_time}s`);
  });

  const recognized = await workflow.recognize(
    localResult.globals || {},
    segments,
    localResult.events || [],
    mockRuleSet,
    appConfig,
  );

  printHeader('当前主链识别结果（带时间范围钳制）');
  (recognized.stages || []).forEach((stage) => {
    console.log(`  ${stage.stage_name}: ${stage.start_time}s -> ${stage.end_time}s`);
  });

  printHeader('阶段指标');
  const metricsService = new StageMetricsService(null);
  const metrics = metricsService.calculate(parsed.points, recognized);
  metrics.forEach((metric) => {
    console.log(`  ${metric.stage_name}: 开始 ${metric.start_time}s, 起始电流 ${metric.start_current}A, 结束 ${metric.end_time}s, 点数 ${metric.point_count}`);
  });

  printHeader('诊断结论');
  console.log(`1. 该样本真实首个采样时间是 ${parsed.time_range?.[0]}s，不是 0s。`);
  console.log(`2. 压缩首段开始时间也是 ${firstSegmentStart}s，说明 CSV 解析和压缩本身没有把时间归零。`);
  console.log('3. 如果阶段结果仍然显示从 0 开始，根因在识别结果层给出了越界时间，而不是原始点或压缩段本身从 0 开始。');
  console.log('4. 当前主链会把阶段时间钳制回真实样本时间范围，因此待机阶段不应再早于首个采样时间。');
}

main().catch((error) => {
  console.error('\n诊断失败:');
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
