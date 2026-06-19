<template>
  <div class="input-area">
    <div class="input-row">
      <textarea
        ref="inputRef"
        v-model="inputText"
        :placeholder="placeholder"
        :disabled="disabled"
        @keydown.enter.exact="handleEnterKey"
        @compositionstart="isComposing = true"
        @compositionend="isComposing = false"
        @blur="isComposing = false"
        rows="1"
        class="message-input"
      ></textarea>
      <button
        v-if="isLoading"
        class="stop-button"
        @click="$emit('stop')"
        :title="$t('chat.stopGenerate') || '停止生成'"
      >
        <svg class="stop-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor"/>
        </svg>
      </button>
      <button
        v-else
        class="send-button"
        :disabled="!inputText.trim() || disabled"
        @click="handleSend"
        :title="$t('chat.send') || '发送'"
      >
        <svg class="send-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M22 2L11 13M22 2L15 22L11 13M22 2L2 9L11 13" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onUnmounted } from 'vue'
import { useI18n } from 'vue-i18n'

const props = defineProps<{
  isLoading?: boolean
  disabled?: boolean
  customPlaceholder?: string
}>()

const emit = defineEmits<{
  send: [content: string]
  stop: []
}>()

const { t } = useI18n()
const inputText = ref('')
const inputRef = ref<HTMLTextAreaElement | null>(null)
const isComposing = ref(false)
let textareaResizeRaf: number | null = null

const placeholder = computed(() => {
  return props.customPlaceholder || t('chat.placeholder')
})

const adjustTextareaHeight = () => {
  if (textareaResizeRaf !== null) {
    cancelAnimationFrame(textareaResizeRaf)
  }

  textareaResizeRaf = requestAnimationFrame(() => {
    textareaResizeRaf = null
    if (!inputRef.value) return
    inputRef.value.style.height = 'auto'
    inputRef.value.style.height = Math.min(inputRef.value.scrollHeight, 150) + 'px'
  })
}

watch(inputText, adjustTextareaHeight)

const handleSend = () => {
  const content = inputText.value.trim()
  if (!content || props.isLoading || props.disabled) return
  emit('send', content)
  inputText.value = ''
  if (inputRef.value) {
    inputRef.value.style.height = 'auto'
  }
}

const handleEnterKey = (event: KeyboardEvent) => {
  if (isComposing.value || event.isComposing) return
  event.preventDefault()
  handleSend()
}

onUnmounted(() => {
  if (textareaResizeRaf !== null) {
    cancelAnimationFrame(textareaResizeRaf)
    textareaResizeRaf = null
  }
})
</script>

<style scoped>
.input-area {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 16px 20px;
  border-top: 1px solid var(--border-color, #e5e7eb);
  background: var(--input-area-bg, #f9fafb);
  position: relative;
}

.input-row {
  display: flex;
  gap: 12px;
  align-items: flex-end;
  background: var(--input-row-bg, #ffffff);
  border: 1px solid var(--input-border, #e5e7eb);
  border-radius: 12px;
  padding: 8px 12px 8px 16px;
  transition: all 0.2s ease;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
}

.input-row:focus-within {
  border-color: var(--primary-color, #2563eb);
  box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.08);
}

.message-input {
  flex: 1;
  padding: 10px 0;
  border: none;
  border-radius: 0;
  font-size: 15px;
  resize: none;
  outline: none;
  background: transparent;
  color: var(--text-primary, #1f2937);
  font-family: inherit;
  line-height: 1.6;
  max-height: 150px;
  overflow-y: auto;
}

.message-input:disabled {
  cursor: not-allowed;
  opacity: 0.7;
}

.message-input::placeholder {
  color: var(--text-placeholder, #a0a0a0);
}

.message-input::-webkit-scrollbar {
  width: 6px;
}

.message-input::-webkit-scrollbar-track {
  background: transparent;
}

.message-input::-webkit-scrollbar-thumb {
  background: var(--scrollbar-thumb, #ccc);
  border-radius: 3px;
}

.message-input::-webkit-scrollbar-thumb:hover {
  background: var(--scrollbar-thumb-hover, #aaa);
}

.send-button {
  flex-shrink: 0;
  width: 40px;
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--primary-color, #2563eb);
  border: none;
  border-radius: 10px;
  cursor: pointer;
  transition: all 0.2s ease;
  box-shadow: 0 1px 3px rgba(37, 99, 235, 0.2);
}

.send-button:hover:not(:disabled) {
  background: var(--primary-hover, #1d4ed8);
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(37, 99, 235, 0.25);
}

.send-button:active:not(:disabled) {
  transform: translateY(0);
  box-shadow: 0 1px 2px rgba(37, 99, 235, 0.2);
}

.send-button:disabled {
  background: var(--disabled-bg, #e5e7eb);
  cursor: not-allowed;
  box-shadow: none;
}

.send-button:disabled .send-icon {
  color: var(--text-disabled, #9ca3af);
}

.send-icon {
  width: 18px;
  height: 18px;
  color: white;
  transition: transform 0.2s ease;
}

.send-button:hover:not(:disabled) .send-icon {
  transform: translateX(1px);
}

.stop-button {
  flex-shrink: 0;
  width: 40px;
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 10px;
  background: var(--danger-color, #dc2626);
  color: white;
  cursor: pointer;
  transition: all 0.2s ease;
  box-shadow: 0 1px 3px rgba(220, 38, 38, 0.2);
}

.stop-button:hover {
  background: var(--danger-hover, #b91c1c);
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(220, 38, 38, 0.25);
}

.stop-button:active {
  transform: translateY(0);
  box-shadow: 0 1px 2px rgba(220, 38, 38, 0.2);
}

.stop-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
}
</style>
