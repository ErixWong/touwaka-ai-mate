<template>
  <Teleport to="body">
    <div class="toast-container" role="region" aria-label="通知消息">
      <TransitionGroup name="toast" tag="div">
        <div
          v-for="item in toastStore.items"
          :key="item.id"
          :class="['toast-item', `toast-${item.type}`]"
          :role="item.type === 'error' ? 'alert' : 'status'"
          :aria-live="item.type === 'error' ? 'assertive' : 'polite'"
        >
          <span class="toast-icon" aria-hidden="true">
            <!-- Success Icon -->
            <svg v-if="item.type === 'success'" viewBox="0 0 24 24" fill="currentColor">
              <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z" />
            </svg>
            <!-- Error Icon -->
            <svg v-else-if="item.type === 'error'" viewBox="0 0 24 24" fill="currentColor">
              <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12 19 6.41z" />
            </svg>
            <!-- Warning Icon -->
            <svg v-else-if="item.type === 'warning'" viewBox="0 0 24 24" fill="currentColor">
              <path d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z" />
            </svg>
            <!-- Info Icon -->
            <svg v-else viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z" />
            </svg>
          </span>
          <span class="toast-message">{{ item.message }}</span>
          <button
            v-if="item.closable"
            class="toast-close"
            :aria-label="t('toast.close')"
            @click="toastStore.remove(item.id)"
          >
            <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12 19 6.41z" />
            </svg>
          </button>
        </div>
      </TransitionGroup>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { useToastStore } from '@/stores/toast'
import { useI18n } from 'vue-i18n'

const toastStore = useToastStore()
const { t } = useI18n()
</script>

<style scoped>
.toast-container {
  position: fixed;
  top: 16px;
  right: 16px;
  z-index: 9999;
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-width: 400px;
  pointer-events: none;
}

.toast-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  border-radius: var(--radius-md, 8px);
  background: var(--bg-primary, #ffffff);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  pointer-events: auto;
  min-height: 48px;
}

/* 类型样式 */
.toast-success {
  border-left: 4px solid var(--success-color, #4caf50);
}

.toast-success .toast-icon {
  color: var(--success-color, #4caf50);
}

.toast-error {
  border-left: 4px solid var(--danger-color, #f44336);
}

.toast-error .toast-icon {
  color: var(--danger-color, #f44336);
}

.toast-warning {
  border-left: 4px solid var(--warning-color, #ff9800);
}

.toast-warning .toast-icon {
  color: var(--warning-color, #ff9800);
}

.toast-info {
  border-left: 4px solid var(--primary-color, #2196f3);
}

.toast-info .toast-icon {
  color: var(--primary-color, #2196f3);
}

/* 图标 */
.toast-icon {
  flex-shrink: 0;
  width: 20px;
  height: 20px;
}

.toast-icon svg {
  width: 100%;
  height: 100%;
}

/* 消息内容 */
.toast-message {
  flex: 1;
  font-size: 14px;
  line-height: 1.5;
  color: var(--text-primary, #333333);
  word-break: break-word;
}

/* 关闭按钮 */
.toast-close {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  padding: 0;
  border: none;
  background: transparent;
  color: var(--text-tertiary, #999999);
  cursor: pointer;
  border-radius: 4px;
  transition: color 0.2s, background-color 0.2s;
}

.toast-close:hover {
  color: var(--text-primary, #333333);
  background: var(--hover-bg, #e8e8e8);
}

.toast-close svg {
  width: 16px;
  height: 16px;
}

/* 动画 */
.toast-enter-from {
  transform: translateX(100%);
  opacity: 0;
}

.toast-leave-to {
  transform: translateX(100%);
  opacity: 0;
}

.toast-enter-active {
  transition: transform 0.3s ease-out, opacity 0.3s ease-out;
}

.toast-leave-active {
  transition: transform 0.2s ease-in, opacity 0.2s ease-in;
}

.toast-move {
  transition: transform 0.3s ease-out;
}

/* 暗色主题 */
[data-theme="dark"] .toast-item {
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
}

/* 响应式 */
@media (max-width: 480px) {
  .toast-container {
    left: 16px;
    right: 16px;
    max-width: none;
  }
}
</style>