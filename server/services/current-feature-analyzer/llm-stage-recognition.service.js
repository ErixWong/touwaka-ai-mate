/**
 * 桥接层：主工程 → app 内实现
 *
 * 原实现 llm-stage-recognition.service.js 已迁移为 stage-recognition-workflow.service.js
 * 本文件仅作为薄封装保留，以确保历史 import 不受影响。
 */
export { default } from '../../../apps/current-feature-analyzer/server/services/stage-recognition-workflow.service.js';