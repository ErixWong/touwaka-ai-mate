<template>
  <div class="state-designer">
    <div v-if="states.length === 0" class="state-empty">
      <p>{{ $t('settings.appManagement.stateDesigner.noStates', '暂无状态定义') }}</p>
    </div>

    <div v-else class="state-list">
      <div
        v-for="(state, index) in states"
        :key="state.id || index"
        class="state-card"
        :class="{
          initial: state.is_initial,
          terminal: state.is_terminal,
          error: state.is_error,
          active: selectedStateIndex === index,
        }"
        @click="selectedStateIndex = index"
      >
        <div class="state-card-header">
          <span class="state-name">{{ state.label || state.name }}</span>
          <div class="state-badges">
            <span v-if="state.is_initial" class="badge initial">{{ $t('settings.appManagement.stateDesigner.initial', '初始') }}</span>
            <span v-if="state.is_terminal" class="badge terminal">{{ $t('settings.appManagement.stateDesigner.terminal', '终态') }}</span>
            <span v-if="state.is_error" class="badge error">{{ $t('settings.appManagement.stateDesigner.error', '错误') }}</span>
          </div>
        </div>
        <div class="state-card-meta">
          <span class="meta-item">{{ state.name }}</span>
          <span v-if="state.handler_id" class="meta-item">
            → {{ getHandlerName(state.handler_id) }}
          </span>
        </div>
        <div v-if="state.success_next_state || state.failure_next_state" class="state-card-flow">
          <span v-if="state.success_next_state" class="flow-success">
            ✓ {{ state.success_next_state }}
          </span>
          <span v-if="state.failure_next_state" class="flow-failure">
            ✗ {{ state.failure_next_state }}
          </span>
        </div>
        <div class="state-card-actions">
          <button v-if="index > 0" class="btn-tiny" @click.stop="moveState(index, -1)">↑</button>
          <button v-if="index < states.length - 1" class="btn-tiny" @click.stop="moveState(index, 1)">↓</button>
          <button class="btn-tiny btn-danger" @click.stop="removeState(index)">×</button>
        </div>
      </div>
    </div>

    <button class="btn-secondary" @click="addState">
      + {{ $t('settings.appManagement.stateDesigner.addState', '添加状态') }}
    </button>

    <!-- 流转可视化 -->
    <div v-if="states.length > 1" class="state-flow">
      <span class="flow-label">{{ $t('settings.appManagement.stateDesigner.flowOrder', '流转顺序') }}:</span>
      <div class="flow-chain">
        <template v-for="(state, index) in states" :key="index">
          <span class="flow-node" :class="{ initial: state.is_initial, terminal: state.is_terminal, error: state.is_error }">
            {{ state.label || state.name }}
          </span>
          <span v-if="index < states.length - 1" class="flow-arrow">→</span>
        </template>
      </div>
    </div>

    <!-- 状态编辑面板 -->
    <div v-if="selectedState" class="state-edit-panel">
      <h4 class="panel-subtitle">{{ $t('settings.appManagement.stateDesigner.editState', '编辑状态') }}</h4>
      <div class="form-row">
        <div class="form-item">
          <label class="form-label">{{ $t('settings.appManagement.stateDesigner.stateName', '状态标识') }} *</label>
          <input v-model="selectedState.name" type="text" class="form-input" placeholder="pending_ocr" />
          <p class="form-hint">{{ $t('settings.appManagement.stateDesigner.stateNameHint', '英文标识，用于系统内部') }}</p>
        </div>
        <div class="form-item">
          <label class="form-label">{{ $t('settings.appManagement.stateDesigner.stateLabel', '显示名称') }} *</label>
          <input v-model="selectedState.label" type="text" class="form-input" :placeholder="$t('settings.appManagement.stateDesigner.stateLabelPlaceholder', '待OCR')" />
        </div>
      </div>
      <div class="form-item-group">
        <label class="form-label checkbox">
          <input v-model="selectedState.is_initial" type="checkbox" @change="handleInitialChange" />
          {{ $t('settings.appManagement.stateDesigner.initial', '初始状态') }}
        </label>
        <label class="form-label checkbox">
          <input v-model="selectedState.is_terminal" type="checkbox" />
          {{ $t('settings.appManagement.stateDesigner.terminal', '终态') }}
        </label>
        <label class="form-label checkbox">
          <input v-model="selectedState.is_error" type="checkbox" />
          {{ $t('settings.appManagement.stateDesigner.error', '错误状态') }}
        </label>
      </div>
      <div class="form-item">
        <label class="form-label">{{ $t('settings.appManagement.stateDesigner.handler', '处理脚本') }}</label>
        <select v-model="selectedState.handler_id" class="form-input">
          <option value="">{{ $t('settings.appManagement.stateDesigner.noHandler', '无（手动处理）') }}</option>
          <option v-for="h in handlers" :key="h.id" :value="h.id">{{ h.name }}</option>
        </select>
      </div>
      <div class="form-row">
        <div class="form-item">
          <label class="form-label">{{ $t('settings.appManagement.stateDesigner.successNext', '成功后转到') }}</label>
          <select v-model="selectedState.success_next_state" class="form-input">
            <option value="">-</option>
            <option v-for="s in otherStates(selectedState.name)" :key="s.name" :value="s.name">{{ s.label || s.name }}</option>
          </select>
        </div>
        <div class="form-item">
          <label class="form-label">{{ $t('settings.appManagement.stateDesigner.failureNext', '失败后转到') }}</label>
          <select v-model="selectedState.failure_next_state" class="form-input">
            <option value="">-</option>
            <option v-for="s in otherStates(selectedState.name)" :key="s.name" :value="s.name">{{ s.label || s.name }}</option>
          </select>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import type { AppState, AppRowHandler } from '@/api/mini-apps'

const props = defineProps<{
  states: AppState[]
  handlers: AppRowHandler[]
}>()

const emit = defineEmits<{
  'update:states': [value: AppState[]]
}>()

const selectedStateIndex = ref(-1)

const selectedState = computed(() => {
  if (selectedStateIndex.value >= 0 && selectedStateIndex.value < props.states.length) {
    return props.states[selectedStateIndex.value]
  }
  return null
})

function getHandlerName(handlerId: string): string {
  const handler = props.handlers.find(h => h.id === handlerId)
  return handler ? handler.name : handlerId
}

function otherStates(currentName: string): AppState[] {
  return props.states.filter(s => s.name !== currentName)
}

function handleInitialChange() {
  if (selectedState.value?.is_initial) {
    props.states.forEach(s => {
      if (s !== selectedState.value) s.is_initial = false
    })
  }
}

function addState() {
  const newState: AppState = {
    id: '',
    app_id: '',
    name: `state_${props.states.length + 1}`,
    label: '',
    sort_order: props.states.length,
    is_initial: props.states.length === 0,
    is_terminal: false,
    is_error: false,
  }
  props.states.push(newState)
  selectedStateIndex.value = props.states.length - 1
}

function removeState(index: number) {
  props.states.splice(index, 1)
  if (selectedStateIndex.value >= props.states.length) {
    selectedStateIndex.value = props.states.length - 1
  }
}

function moveState(index: number, direction: number) {
  const newIndex = index + direction
  if (newIndex < 0 || newIndex >= props.states.length) return
  const temp = props.states[index]!
  props.states[index] = props.states[newIndex]!
  props.states[newIndex] = temp
  props.states.forEach((s, i) => { s.sort_order = i })
  if (selectedStateIndex.value === index) {
    selectedStateIndex.value = newIndex
  }
}
</script>

<style scoped>
.state-designer {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.state-empty {
  text-align: center;
  padding: 24px;
  color: var(--text-tertiary, #999);
  border: 1px dashed var(--border-color, #e0e0e0);
  border-radius: 8px;
}

.state-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.state-card {
  position: relative;
  padding: 10px 12px;
  border-radius: 6px;
  border: 1px solid var(--border-color, #e0e0e0);
  cursor: pointer;
  transition: border-color 0.2s;
}

.state-card:hover,
.state-card.active {
  border-color: var(--primary-color, #2196f3);
}

.state-card.active {
  background: var(--primary-color-light, rgba(33, 150, 243, 0.05));
}

.state-card.initial {
  border-left: 3px solid #4caf50;
}

.state-card.terminal {
  border-left: 3px solid #2196f3;
}

.state-card.error {
  border-left: 3px solid #e53935;
}

.state-card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.state-name {
  font-weight: 500;
  font-size: 13px;
}

.state-badges {
  display: flex;
  gap: 4px;
}

.badge {
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 3px;
}

.badge.initial { background: #e8f5e9; color: #2e7d32; }
.badge.terminal { background: #e3f2fd; color: #1565c0; }
.badge.error { background: #ffebee; color: #c62828; }

.state-card-meta {
  display: flex;
  gap: 8px;
  margin-top: 4px;
  font-size: 11px;
  color: var(--text-tertiary, #999);
}

.state-card-flow {
  display: flex;
  gap: 12px;
  margin-top: 4px;
  font-size: 11px;
}

.flow-success { color: #2e7d32; }
.flow-failure { color: #c62828; }

.state-card-actions {
  position: absolute;
  top: 8px;
  right: 8px;
  display: flex;
  gap: 4px;
  opacity: 0;
  transition: opacity 0.2s;
}

.state-card:hover .state-card-actions {
  opacity: 1;
}

.state-flow {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  background: var(--bg-secondary, #fafafa);
  border-radius: 6px;
}

.flow-label {
  font-size: 12px;
  color: var(--text-secondary, #666);
  flex-shrink: 0;
}

.flow-chain {
  display: flex;
  align-items: center;
  gap: 4px;
  overflow-x: auto;
  font-size: 12px;
}

.flow-node {
  padding: 2px 8px;
  border-radius: 4px;
  background: white;
  border: 1px solid var(--border-color, #e0e0e0);
  white-space: nowrap;
}

.flow-node.initial { border-color: #4caf50; color: #2e7d32; }
.flow-node.terminal { border-color: #2196f3; color: #1565c0; }
.flow-node.error { border-color: #e53935; color: #c62828; }

.flow-arrow {
  color: var(--text-tertiary, #999);
}

.state-edit-panel {
  padding: 16px;
  border: 1px solid var(--border-color, #e0e0e0);
  border-radius: 8px;
  background: var(--bg-secondary, #fafafa);
}

.panel-subtitle {
  font-size: 13px;
  font-weight: 500;
  margin: 0 0 12px;
  color: var(--text-primary, #333);
}

.btn-tiny {
  width: 22px;
  height: 22px;
  border: 1px solid var(--border-color, #e0e0e0);
  border-radius: 4px;
  background: white;
  cursor: pointer;
  font-size: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-secondary, #666);
}

.btn-tiny:hover {
  background: var(--bg-secondary, #f5f5f5);
}

.btn-tiny.btn-danger:hover {
  background: #ffebee;
  color: #e53935;
}

.btn-secondary {
  padding: 6px 12px;
  border-radius: 6px;
  border: 1px dashed var(--border-color, #e0e0e0);
  background: transparent;
  cursor: pointer;
  font-size: 13px;
  color: var(--primary-color, #2196f3);
}

.btn-secondary:hover {
  border-color: var(--primary-color, #2196f3);
  background: var(--primary-color-light, rgba(33, 150, 243, 0.05));
}

.form-row {
  display: flex;
  gap: 16px;
}

.form-item {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.form-label {
  font-size: 13px;
  font-weight: 500;
  color: var(--text-primary, #333);
}

.form-label.checkbox {
  display: flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
}

.form-input {
  padding: 8px 12px;
  border: 1px solid var(--border-color, #e0e0e0);
  border-radius: 6px;
  font-size: 13px;
  outline: none;
  transition: border-color 0.2s;
}

.form-input:focus {
  border-color: var(--primary-color, #2196f3);
}

.form-hint {
  font-size: 12px;
  color: var(--text-tertiary, #999);
  margin: 2px 0 0;
}

.form-item-group {
  display: flex;
  gap: 24px;
  padding-top: 8px;
}
</style>
