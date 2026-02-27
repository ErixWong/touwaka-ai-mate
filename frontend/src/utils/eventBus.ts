import { ref, readonly } from 'vue'

/**
 * 简单的事件总线，用于组件间通信
 */
class EventBus {
  private listeners: Map<string, Set<(...args: any[]) => void>> = new Map()

  on(event: string, callback: (...args: any[]) => void) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set())
    }
    this.listeners.get(event)!.add(callback)
    
    // 返回取消订阅函数
    return () => {
      this.listeners.get(event)?.delete(callback)
    }
  }

  emit(event: string, ...args: any[]) {
    this.listeners.get(event)?.forEach(callback => {
      try {
        callback(...args)
      } catch (err) {
        console.error(`Error in event listener for ${event}:`, err)
      }
    })
  }

  off(event: string, callback: (...args: any[]) => void) {
    this.listeners.get(event)?.delete(callback)
  }
}

export const eventBus = new EventBus()

// 预定义的事件名称
export const EVENTS = {
  SKILL_REGISTERED: 'skill:registered',
  SKILL_ASSIGNED: 'skill:assigned',
  SKILL_UNASSIGNED: 'skill:unassigned',
  SKILL_TOGGLED: 'skill:toggled',
  SKILL_DELETED: 'skill:deleted',
} as const
