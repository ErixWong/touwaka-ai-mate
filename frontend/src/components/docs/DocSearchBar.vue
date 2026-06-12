<template>
  <div class="doc-search-bar">
    <div class="search-primary">
      <el-select
        v-model="localDocType"
        :placeholder="$t('docs.filterType')"
        clearable
        class="search-select"
        @change="$emit('update:docType', $event)"
        @clear="$emit('update:docType', '')"
      >
        <el-option :label="$t('docs.typeAll')" value="" />
        <el-option label="KB" value="knowledge" />
        <el-option label="Contract" value="contract" />
        <el-option label="Dept" value="department_doc" />
        <el-option label="Std" value="standard" />
      </el-select>
      <el-select
        :model-value="recallScope"
        :placeholder="$t('docs.recallScope')"
        class="search-select scope-select"
        @update:model-value="$emit('update:recallScope', $event)"
      >
        <el-option label="All" value="all" />
        <el-option label="KB" value="knowledge" />
        <el-option label="Contract" value="contract" />
      </el-select>
      <el-input
        :model-value="recallQuery"
        :placeholder="$t('docs.recallPlaceholder')"
        class="search-input"
        @input="$emit('update:recallQuery', $event)"
        @keyup.enter="$emit('recall')"
      >
        <template #append>
          <el-button :loading="recallLoading" @click="$emit('recall')">
            {{ $t('common.search') }}
          </el-button>
        </template>
      </el-input>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'

const props = defineProps<{
  docType: string
  recallQuery: string
  recallScope: string
  recallLoading?: boolean
}>()

defineEmits<{
  'update:docType': [value: string]
  'update:recallQuery': [value: string]
  'update:recallScope': [value: string]
  'recall': []
}>()

const localDocType = ref(props.docType)
watch(() => props.docType, (v) => { localDocType.value = v })
</script>

<style scoped>
.doc-search-bar { margin-bottom: 16px; }
.search-primary { display: flex; gap: 8px; }
.search-select { width: 130px; flex-shrink: 0; }
.scope-select { width: 110px; flex-shrink: 0; }
.search-input { flex: 1; min-width: 0; }

@media (max-width: 640px) {
  .search-primary { flex-wrap: wrap; }
  .search-select { width: 100%; flex-basis: calc(50% - 4px); }
  .scope-select { width: 100%; flex-basis: calc(50% - 4px); }
  .search-input { width: 100%; flex-basis: 100%; }
}
</style>
