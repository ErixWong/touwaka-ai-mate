<template>
  <div class="lang-selector">
    <select v-model="currentLocale" class="lang-select">
      <option v-for="lang in availableLocales" :key="lang.value" :value="lang.value">
        {{ lang.label }}
      </option>
    </select>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { setLocale } from '@/i18n'
import type { Locale } from '@/i18n'

// 可用语言列表
const availableLocales = [
  { value: 'zh-CN', label: '中文' },
  { value: 'en-US', label: 'English' },
]

const { locale } = useI18n()

// 当前语言
const currentLocale = computed({
  get: () => locale.value as Locale,
  set: (value: Locale) => {
    setLocale(value)
  }
})
</script>

<style scoped>
.lang-selector {
  margin-left: 16px;
}

.lang-select {
  padding: 6px 12px;
  background: #f5f5f5;
  border: 1px solid #ddd;
  border-radius: 8px;
  font-size: 13px;
  color: #555;
  cursor: pointer;
  transition: all 0.2s;
}

.lang-select:hover {
  border-color: #667eea;
}

.lang-select:focus {
  outline: none;
  border-color: #667eea;
  box-shadow: 0 0 0 2px rgba(102, 126, 234, 0.1);
}
</style>