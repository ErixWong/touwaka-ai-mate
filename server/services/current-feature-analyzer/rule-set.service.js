/**
 * 桥接层：主工程 → app 内实现
 *
 * 真实业务实现位于 apps/current-feature-analyzer/server/services/rule-set.service.js
 * 本文件仅作为薄封装保留，以确保历史 import 不受影响。
 */
export { default } from '../../../apps/current-feature-analyzer/server/services/rule-set.service.js';