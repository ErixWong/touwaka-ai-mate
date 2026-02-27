<template>
  <div class="model-selector">
    <select 
      :value="modelValue" 
      @change="handleChange"
      class="model-select"
    >
      <option value="" disabled>{{ $t('chat.selectModel') || '选择模型' }}</option>
      <option 
        v-for="model in availableModels" 
        :key="model.id" 
        :value="model.id"
      >
        {{ model.name }}
      </option>
    </select>
    <span class="select-icon">▼</span>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { useModelStore } from '@/stores/model'

const props = defineProps<{
  modelValue: string
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string]
}>()

const modelStore = useModelStore()

const availableModels = computed(() => {
  return modelStore.models.filter(m => m.is_active)
})

const handleChange = (event: Event) => {
  const target = event.target as HTMLSelectElement
  emit('update:modelValue', target.value)
}

onMounted(() => {
  // 确保模型列表已加载
  if (modelStore.models.length === 0) {
    modelStore.loadModels()
  }
})
</script>

<style scoped>
.model-selector {
  position: relative;
  display: inline-flex;
  align-items: center;
}

.model-select {
  appearance: none;
  background: var(--bg-secondary, #f5f5f5);
  border: 1px solid var(--border-color, #e0e0e0);
  border-radius: 6px;
  padding: 6px 28px 6px 12px;
  font-size: 13px;
  color: var(--text-primary, #333);
  cursor: pointer;
  min-width: 140px;
  outline: none;
  transition: all 0.2s ease;
}

.model-select:hover {
  border-color: var(--primary-color, #2196f3);
}

.model-select:focus {
  border-color: var(--primary-color, #2196f3);
  box-shadow: 0 0 0 2px var(--primary-light, rgba(33, 150, 243, 0.1));
}

.select-icon {
  position: absolute;
  right: 10px;
  font-size: 10px;
  color: var(--text-secondary, #666);
  pointer-events: none;
}
</style>
