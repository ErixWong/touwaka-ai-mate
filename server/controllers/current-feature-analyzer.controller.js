/**
 * 桥接层：主工程 → app 内实现
 *
 * 真实业务实现位于 apps/current-feature-analyzer/server/controller.js
 * 本文件仅作为薄封装保留，以确保 server/index.js 现有注册方式不受影响。
 */
export { default } from '../../apps/current-feature-analyzer/server/controller.js';

