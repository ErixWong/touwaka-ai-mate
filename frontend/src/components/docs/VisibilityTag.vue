<template>
  <span class="vis-badge" :class="`vis-${visibility}`">
    <el-icon :size="11">
      <Lock v-if="visibility === 'private'" />
      <OfficeBuilding v-else-if="visibility === 'department'" />
      <View v-else />
    </el-icon>
    {{ label }}
  </span>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { Lock, OfficeBuilding, View } from '@element-plus/icons-vue'
import { useI18n } from 'vue-i18n'

const props = defineProps<{
  visibility: string
}>()

const { t } = useI18n()

const label = computed(() => {
  const map: Record<string, string> = {
    private: t('docs.workspace.collection.visPrivate'),
    department: t('docs.workspace.collection.visDepartment'),
    public: t('docs.workspace.collection.visPublic'),
  }
  return map[props.visibility] || props.visibility
})
</script>

<style scoped>
.vis-badge {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 1px 8px;
  border-radius: 999px;
  font-size: 12px;
  line-height: 1.7;
  white-space: nowrap;
}
.vis-private { background: #eef1f6; color: #6b7280; }
.vis-department { background: #fff4e5; color: #b45309; }
.vis-public { background: #e6f7ee; color: #059669; }
</style>
