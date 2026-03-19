/**
 * Toast 消息类型定义
 */

/** Toast 消息类型 */
export type ToastType = 'success' | 'error' | 'warning' | 'info'

/** Toast 消息项 */
export interface ToastItem {
  /** 唯一标识 */
  id: string
  /** 消息类型 */
  type: ToastType
  /** 消息内容 */
  message: string
  /** 持续时间（毫秒），默认 3000，0 表示不自动关闭 */
  duration?: number
  /** 是否显示关闭按钮，默认 true */
  closable?: boolean
}

/** 创建 Toast 的参数（不含 id） */
export type ToastOptions = Omit<ToastItem, 'id'>

/** Toast Store 接口 */
export interface ToastStore {
  /** 当前显示的 Toast 列表 */
  items: ToastItem[]
  /** 显示 Toast */
  show(options: ToastOptions): void
  /** 显示成功消息 */
  success(message: string, options?: Partial<ToastOptions>): void
  /** 显示错误消息 */
  error(message: string, options?: Partial<ToastOptions>): void
  /** 显示警告消息 */
  warning(message: string, options?: Partial<ToastOptions>): void
  /** 显示信息消息 */
  info(message: string, options?: Partial<ToastOptions>): void
  /** 移除指定 Toast */
  remove(id: string): void
  /** 清空所有 Toast */
  clear(): void
}

/** Toast 默认配置 */
export const TOAST_DEFAULTS = {
  /** 默认持续时间 3 秒 */
  duration: 3000,
  /** 默认显示关闭按钮 */
  closable: true,
  /** 最大显示数量 */
  maxItems: 5,
} as const