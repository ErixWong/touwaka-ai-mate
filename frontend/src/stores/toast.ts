import { ref } from 'vue'
import { defineStore } from 'pinia'
import type { ToastItem, ToastOptions, ToastType } from '@/types/toast'
import { TOAST_DEFAULTS } from '@/types/toast'

/** 生成唯一 ID */
function generateId(): string {
  return `toast-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

export const useToastStore = defineStore('toast', () => {
  /** 当前显示的 Toast 列表 */
  const items = ref<ToastItem[]>([])

  /**
   * 显示 Toast 消息
   * @param options Toast 配置选项
   */
  function show(options: ToastOptions): void {
    const item: ToastItem = {
      id: generateId(),
      type: options.type,
      message: options.message,
      duration: options.duration ?? TOAST_DEFAULTS.duration,
      closable: options.closable ?? TOAST_DEFAULTS.closable,
    }

    // 添加到列表
    items.value.push(item)

    // 限制最大显示数量，移除最早的
    if (items.value.length > TOAST_DEFAULTS.maxItems) {
      items.value.shift()
    }

    // 设置自动关闭定时器
    if (item.duration && item.duration > 0) {
      setTimeout(() => {
        remove(item.id)
      }, item.duration)
    }
  }

  /**
   * 显示成功消息
   * @param message 消息内容
   * @param options 可选配置
   */
  function success(message: string, options?: Partial<ToastOptions>): void {
    show({ type: 'success', message, ...options })
  }

  /**
   * 显示错误消息
   * @param message 消息内容
   * @param options 可选配置
   */
  function error(message: string, options?: Partial<ToastOptions>): void {
    show({ type: 'error', message, ...options })
  }

  /**
   * 显示警告消息
   * @param message 消息内容
   * @param options 可选配置
   */
  function warning(message: string, options?: Partial<ToastOptions>): void {
    show({ type: 'warning', message, ...options })
  }

  /**
   * 显示信息消息
   * @param message 消息内容
   * @param options 可选配置
   */
  function info(message: string, options?: Partial<ToastOptions>): void {
    show({ type: 'info', message, ...options })
  }

  /**
   * 移除指定 Toast
   * @param id Toast ID
   */
  function remove(id: string): void {
    const index = items.value.findIndex((item) => item.id === id)
    if (index !== -1) {
      items.value.splice(index, 1)
    }
  }

  /**
   * 清空所有 Toast
   */
  function clear(): void {
    items.value = []
  }

  return {
    items,
    show,
    success,
    error,
    warning,
    info,
    remove,
    clear,
  }
})