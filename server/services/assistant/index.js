/**
 * Assistant Service - 助理服务入口
 *
 * 模块化架构：
 * - manager.js: 核心协调器（含请求管理）
 * - config-repository.js: 配置管理
 * - executor.js: 执行引擎
 * - tool-integration.js: 工具集成
 * - vision-processor.js: 视觉处理
 * - expert-notifier.js: 专家通知
 */

// 导出主管理器
export { default as AssistantManager, getAssistantManager, setAssistantManager } from './manager.js';

// 导出子模块（供直接使用）
export { refreshAssistantsCache, getAssistant, createAssistant, updateAssistant, deleteAssistant, getAssistantDetail } from './config-repository.js';
export { executeAssistant, executeDirect, executeLLM, executeLLMWithTools } from './executor.js';
export { getAssistantTools, getInheritedToolDefinitions, executeInheritedTool } from './tool-integration.js';
export { extractImageInput, executeVisionWithInput, readImageFile } from './vision-processor.js';
export { pushSSENotification, notifyExpertResult, triggerExpertResponse } from './expert-notifier.js';

// 默认导出
export { default } from './manager.js';