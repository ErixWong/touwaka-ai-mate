/**
 * Context Organizer Module - 上下文组织模块
 * 导出所有上下文组织相关的类和接口
 */

// 接口定义
export {
  IContextOrganizer,
  ContextResult,
  ContextOrganizerFactory,
  organizerFactory,
} from './interface.js';

// 基础组织器
export {
  BaseContextOrganizer,
  processSingleMultimodalMessage,
} from './base-organizer.js';

// 完整上下文组织器
export {
  FullContextOrganizer,
} from './full-organizer.js';

// 简单上下文组织器
export {
  SimpleContextOrganizer,
} from './simple-organizer.js';

// 默认导出工厂实例
import { organizerFactory } from './interface.js';
import { FullContextOrganizer } from './full-organizer.js';
import { SimpleContextOrganizer } from './simple-organizer.js';

// 可用的策略列表
const AVAILABLE_STRATEGIES = ['full', 'simple'];

/**
 * 创建上下文组织器（静态方法）
 * @param {string} strategy - 策略名称 ('full' | 'simple')
 * @param {object} expertConfig - 专家配置
 * @param {object} options - 可选配置
 * @returns {IContextOrganizer}
 */
export function createContextOrganizer(strategy, expertConfig, options = {}) {
  switch (strategy) {
    case 'full':
      return new FullContextOrganizer(expertConfig, options);
    case 'simple':
      return new SimpleContextOrganizer(expertConfig, options);
    default:
      // 默认使用 full 策略
      return new FullContextOrganizer(expertConfig, options);
  }
}

/**
 * 检查策略是否有效
 * @param {string} strategy - 策略名称
 * @returns {boolean}
 */
export function isValidStrategy(strategy) {
  return AVAILABLE_STRATEGIES.includes(strategy);
}

/**
 * 获取所有可用的策略
 * @returns {Array<{name: string, description: string}>}
 */
export function getAvailableStrategies() {
  return [
    { name: 'full', description: '完整上下文组织策略：全部未归档消息 + Inner Voices + Topic 总结' },
    { name: 'simple', description: '简单上下文组织策略：近期 10 条消息 + 5 个 Topic' },
  ];
}

/**
 * 扩展 ContextOrganizerFactory 类，添加静态方法
 */
const OriginalFactory = organizerFactory.constructor;

/**
 * 静态创建方法
 */
OriginalFactory.create = createContextOrganizer;

/**
 * 静态验证方法
 */
OriginalFactory.isValidStrategy = isValidStrategy;

/**
 * 静态获取可用策略方法
 */
OriginalFactory.getAvailableStrategies = getAvailableStrategies;

/**
 * 创建并注册默认的上下文组织器
 * @param {object} expertConfig - 专家配置
 * @returns {ContextOrganizerFactory}
 */
export function createOrganizerFactory(expertConfig) {
  // 注册完整上下文组织器
  organizerFactory.register('full', new FullContextOrganizer(expertConfig));

  // 注册简单上下文组织器
  organizerFactory.register('simple', new SimpleContextOrganizer(expertConfig));

  return organizerFactory;
}

export default organizerFactory;
