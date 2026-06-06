<template>
  <div class="psyche-config-panel">
    <el-divider content-position="left">
      <span style="font-size: 13px; color: #909399;">Psyche 精简上下文配置</span>
    </el-divider>
    <el-alert
      type="info"
      :closable="false"
      show-icon
      style="margin-bottom: 16px;"
    >
      <template #title>
        Psyche 是 minimal 策略的核心机制，使用工作记忆替代原始消息，实现精简高效的上下文管理。
      </template>
    </el-alert>

    <el-form-item :label="$t('settings.maxTokensRatio')">
      <el-slider
        v-model="localConfig.max_tokens_ratio"
        :min="0.1"
        :max="0.5"
        :step="0.05"
        show-input
        :format-tooltip="(val) => (val * 100).toFixed(0) + '%'"
      />
      <div class="el-form-item__tip">{{ $t('settings.maxTokensRatioHint') }}</div>
    </el-form-item>

    <el-form-item :label="$t('settings.reflectionLookback')">
      <el-input-number
        v-model="localConfig.reflection_lookback"
        :min="1"
        :max="10"
        :step="1"
      />
      <div class="el-form-item__tip">{{ $t('settings.reflectionLookbackHint') }}</div>
    </el-form-item>

    <el-form-item :label="$t('settings.enableNotes')">
      <el-switch v-model="localConfig.enable_notes" />
      <div class="el-form-item__tip">{{ $t('settings.enableNotesHint') }}</div>
    </el-form-item>
  </div>
</template>

<script setup>
import { reactive, watch, onMounted } from 'vue';

const props = defineProps({
  modelValue: {
    type: Object,
    default: () => ({}),
  },
});

const emit = defineEmits(['update:modelValue']);

const localConfig = reactive({
  max_tokens_ratio: 0.3,
  reflection_lookback: 4,
  enable_notes: true,
});

onMounted(() => {
  syncFromProps();
});

// P1-1: 监听外部值变化，同步到本地状态
watch(() => props.modelValue, () => {
  syncFromProps();
});

function syncFromProps() {
  if (props.modelValue && typeof props.modelValue === 'object') {
    localConfig.max_tokens_ratio = props.modelValue.max_tokens_ratio ?? 0.3;
    localConfig.reflection_lookback = props.modelValue.reflection_lookback ?? 4;
    localConfig.enable_notes = props.modelValue.enable_notes !== false;
  }
}

watch(localConfig, () => {
  emit('update:modelValue', { ...localConfig });
}, { deep: true });
</script>

<style scoped>
.psyche-config-panel {
  padding: 0 16px;
  background: #f9fafb;
  border-radius: 8px;
  margin-bottom: 16px;
}
</style>
