<template>
  <div class="mcp-tab">
    <!-- 左侧：Server 列表 -->
    <div class="panel server-panel">
      <div class="panel-header">
        <h3 class="panel-title">{{ $t('settings.mcp.serverManagement') }}</h3>
        <button class="btn-icon-add" @click="openServerDialog()" :title="$t('settings.mcp.addServer')">
          <span class="icon">+</span>
        </button>
      </div>

      <div v-if="loading" class="loading-state">
        {{ $t('common.loading') }}
      </div>

      <div v-else-if="servers.length === 0" class="empty-state">
        <div class="empty-icon">📭</div>
        <p>{{ $t('settings.mcp.noServers') }}</p>
      </div>

      <div v-else class="server-list-container">
        <div class="server-list">
          <div
            v-for="server in servers"
            :key="server.id"
            class="server-item"
            :class="{ active: selectedServer?.id === server.id, inactive: !server.is_active }"
          >
            <button
              class="server-name-btn"
              @click="selectServer(server)"
            >
              <span class="server-name">{{ server.name }}</span>
              <span v-if="!server.is_active" class="badge inactive">
                {{ $t('settings.inactive') }}
              </span>
              <span v-if="server.is_public" class="badge public">
                {{ $t('settings.mcp.public') }}
              </span>
            </button>
            <button
              class="btn-edit"
              :class="{ 'btn-inactive': !server.is_active }"
              @click.stop="openServerDialog(server)"
              :title="$t('common.edit')"
            >
              {{ $t('common.edit') }}
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- 右侧：Server 详情 -->
    <div class="panel detail-panel">
      <div v-if="!selectedServer" class="empty-state select-server-hint">
        {{ $t('settings.mcp.selectServerHint') }}
      </div>

      <template v-else>
        <!-- 子 Tab 切换 -->
        <div class="mcp-sub-tabs">
          <button
            class="sub-tab-btn"
            :class="{ active: detailSubTab === 'tools' }"
            @click="detailSubTab = 'tools'"
          >
            {{ $t('settings.mcp.tools') }}
          </button>
          <button
            class="sub-tab-btn"
            :class="{ active: detailSubTab === 'credentials' }"
            @click="detailSubTab = 'credentials'"
          >
            {{ $t('settings.mcp.credentials') }}
          </button>
          <button
            v-if="isAdmin"
            class="sub-tab-btn"
            :class="{ active: detailSubTab === 'defaultCredential' }"
            @click="detailSubTab = 'defaultCredential'"
          >
            {{ $t('settings.mcp.defaultCredential') }}
          </button>
        </div>

        <!-- 工具列表 Tab -->
        <div v-if="detailSubTab === 'tools'" class="detail-tab-content">
          <div class="toolbar">
            <button class="btn-refresh" @click="refreshTools" :disabled="toolsLoading">
              🔄 {{ $t('settings.mcp.refreshTools') }}
            </button>
          </div>

          <div v-if="toolsLoading" class="loading-state">
            {{ $t('common.loading') }}
          </div>

          <div v-else-if="serverTools.length === 0" class="empty-state">
            {{ $t('settings.mcp.noTools') }}
          </div>

          <div v-else class="tools-list">
            <div
              v-for="tool in serverTools"
              :key="tool.id"
              class="tool-item"
            >
              <div class="tool-info">
                <span class="tool-name">mcp_{{ selectedServer?.name }}_{{ tool.tool_name }}</span>
                <p v-if="tool.tool_description" class="tool-description">
                  {{ tool.tool_description }}
                </p>
              </div>
            </div>
          </div>
        </div>

        <!-- 用户凭证 Tab -->
        <div v-if="detailSubTab === 'credentials'" class="detail-tab-content">
          <div v-if="credentialsLoading" class="loading-state">
            {{ $t('common.loading') }}
          </div>

          <div v-else class="credential-form">
            <div class="form-item">
              <label class="form-label">{{ $t('settings.mcp.envOverrides') }}</label>
              <textarea
                v-model="userCredentialForm.env_overrides"
                class="form-input"
                rows="5"
                :placeholder="$t('settings.mcp.envOverridesPlaceholder')"
              ></textarea>
              <p class="form-hint">{{ $t('settings.mcp.envOverridesHint') }}</p>
            </div>
            <div class="form-actions">
              <button
                v-if="userCredential"
                class="btn-delete-small"
                @click="deleteUserCredential"
              >
                {{ $t('common.delete') }}
              </button>
              <button
                class="btn-save"
                :disabled="credentialsSaving"
                @click="saveUserCredential"
              >
                {{ credentialsSaving ? $t('common.saving') : $t('common.save') }}
              </button>
            </div>
          </div>
        </div>

        <!-- 系统默认凭证 Tab（管理员） -->
        <div v-if="detailSubTab === 'defaultCredential' && isAdmin" class="detail-tab-content">
          <div v-if="defaultCredentialLoading" class="loading-state">
            {{ $t('common.loading') }}
          </div>

          <div v-else class="credential-form">
            <div class="form-item">
              <label class="form-label">{{ $t('settings.mcp.defaultEnvOverrides') }}</label>
              <textarea
                v-model="defaultCredentialForm.env_overrides"
                class="form-input"
                rows="5"
                :placeholder="$t('settings.mcp.envOverridesPlaceholder')"
              ></textarea>
              <p class="form-hint">{{ $t('settings.mcp.defaultEnvOverridesHint') }}</p>
            </div>
            <div class="form-actions">
              <button
                v-if="defaultCredential"
                class="btn-delete-small"
                @click="deleteDefaultCredential"
              >
                {{ $t('common.delete') }}
              </button>
              <button
                class="btn-save"
                :disabled="defaultCredentialSaving"
                @click="saveDefaultCredential"
              >
                {{ defaultCredentialSaving ? $t('common.saving') : $t('common.save') }}
              </button>
            </div>
          </div>
        </div>
      </template>
    </div>

    <!-- Server 添加/编辑对话框 -->
    <div v-if="showServerDialog" class="dialog-overlay">
      <div class="dialog">
        <h3 class="dialog-title">
          {{ editingServer ? $t('settings.mcp.editServer') : $t('settings.mcp.addServer') }}
        </h3>
        <div class="dialog-body">
          <div class="form-item">
            <label class="form-label">{{ $t('settings.mcp.serverName') }} *</label>
            <input
              v-model="serverForm.name"
              type="text"
              class="form-input"
              :placeholder="$t('settings.mcp.serverNamePlaceholder')"
            />
            <p class="form-hint">{{ $t('settings.mcp.serverNameHint') }}</p>
          </div>
          <div class="form-item">
            <label class="form-label">{{ $t('settings.mcp.command') }} *</label>
            <input
              v-model="serverForm.command"
              type="text"
              class="form-input"
              :placeholder="$t('settings.mcp.commandPlaceholder')"
            />
            <p class="form-hint">{{ $t('settings.mcp.commandHint') }}</p>
          </div>
          <div class="form-item">
            <label class="form-label">{{ $t('settings.mcp.args') }}</label>
            <textarea
              v-model="serverForm.args"
              class="form-input"
              rows="3"
              :placeholder="$t('settings.mcp.argsPlaceholder')"
            ></textarea>
            <p class="form-hint">{{ $t('settings.mcp.argsHint') }}</p>
          </div>
          <div class="form-item">
            <label class="form-label">{{ $t('settings.mcp.env') }}</label>
            <textarea
              v-model="serverForm.env"
              class="form-input"
              rows="3"
              :placeholder="$t('settings.mcp.envPlaceholder')"
            ></textarea>
            <p class="form-hint">{{ $t('settings.mcp.envHint') }}</p>
          </div>
          <div class="form-item checkbox">
            <label class="form-label">
              <input v-model="serverForm.is_public" type="checkbox" />
              {{ $t('settings.mcp.isPublic') }}
            </label>
            <p class="form-hint">{{ $t('settings.mcp.isPublicHint') }}</p>
          </div>
          <div class="form-item checkbox">
            <label class="form-label">
              <input v-model="serverForm.is_active" type="checkbox" />
              {{ $t('settings.isActive') }}
            </label>
          </div>
        </div>
        <div class="dialog-footer">
          <div class="footer-left">
            <button
              v-if="editingServer"
              class="btn-delete"
              @click="confirmDeleteServerFromDialog"
            >
              {{ $t('common.delete') }}
            </button>
          </div>
          <div class="footer-right">
            <button class="btn-cancel" @click="closeServerDialog">{{ $t('common.cancel') }}</button>
            <button class="btn-confirm" :disabled="!isServerFormValid" @click="saveServer">
              {{ $t('common.save') }}
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- Server 删除确认对话框 -->
    <div v-if="showDeleteServerDialog" class="dialog-overlay">
      <div class="dialog dialog-confirm">
        <h3 class="dialog-title">{{ $t('common.confirmDelete') }}</h3>
        <p class="dialog-message">
          {{ $t('settings.mcp.deleteServerConfirm', { name: deletingServer?.name }) }}
        </p>
        <div class="dialog-footer">
          <button class="btn-cancel" @click="closeDeleteServerDialog">{{ $t('common.cancel') }}</button>
          <button class="btn-confirm delete" @click="deleteServer">
            {{ $t('common.delete') }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useUserStore } from '@/stores/user'
import { useToastStore } from '@/stores/toast'
import { mcpApi, type McpServer, type McpToolCache, type McpUserCredential, type McpCredential } from '@/api/services'

const { t } = useI18n()
const userStore = useUserStore()
const toast = useToastStore()

// 是否为管理员
const isAdmin = computed(() => userStore.isAdmin)

// Server 列表状态
const loading = ref(false)
const servers = ref<McpServer[]>([])
const selectedServer = ref<McpServer | null>(null)
const detailSubTab = ref<'tools' | 'credentials' | 'defaultCredential'>('tools')

// Server 对话框
const showServerDialog = ref(false)
const editingServer = ref<McpServer | null>(null)
const serverForm = reactive({
  name: '',
  command: '',
  args: '',
  env: '',
  is_public: false,
  is_active: true,
})

const isServerFormValid = computed(() => {
  return serverForm.name.trim() && serverForm.command.trim()
})

// Server 删除对话框
const showDeleteServerDialog = ref(false)
const deletingServer = ref<McpServer | null>(null)

// 工具列表状态
const serverTools = ref<McpToolCache[]>([])
const toolsLoading = ref(false)

// 用户凭证状态
const userCredential = ref<McpUserCredential | null>(null)
const credentialsLoading = ref(false)
const credentialsSaving = ref(false)
const userCredentialForm = reactive({
  env_overrides: '',
})

// 系统默认凭证状态
const defaultCredential = ref<McpCredential | null>(null)
const defaultCredentialLoading = ref(false)
const defaultCredentialSaving = ref(false)
const defaultCredentialForm = reactive({
  env_overrides: '',
})

// 加载 Server 列表
const loadServers = async () => {
  loading.value = true
  try {
    servers.value = await mcpApi.getServers()
  } catch (error: any) {
    toast.error(t('settings.mcp.loadServersFailed') + ': ' + error.message)
  } finally {
    loading.value = false
  }
}

// 选择 Server
const selectServer = (server: McpServer) => {
  selectedServer.value = server
  detailSubTab.value = 'tools'
  // 加载工具列表
  loadServerTools(server.id)
  // 加载用户凭证
  loadUserCredential(server.id)
  // 如果是管理员，加载系统默认凭证
  if (isAdmin.value) {
    loadDefaultCredential(server.id)
  }
}

// 加载 Server 工具列表
const loadServerTools = async (serverId: string) => {
  toolsLoading.value = true
  try {
    serverTools.value = await mcpApi.getServerTools(serverId)
  } catch (error: any) {
    toast.error(t('settings.mcp.loadToolsFailed') + ': ' + error.message)
  } finally {
    toolsLoading.value = false
  }
}

// 刷新工具列表
const refreshTools = async () => {
  if (!selectedServer.value) return
  toolsLoading.value = true
  try {
    const result = await mcpApi.refreshTools(selectedServer.value.id)
    serverTools.value = result.tools
    toast.success(result.message || t('settings.mcp.refreshToolsSuccess'))
  } catch (error: any) {
    toast.error(t('settings.mcp.refreshToolsFailed') + ': ' + error.message)
  } finally {
    toolsLoading.value = false
  }
}

// 加载用户凭证
const loadUserCredential = async (serverId: string) => {
  credentialsLoading.value = true
  try {
    const result = await mcpApi.getUserCredentialForServer(serverId)
    userCredential.value = result
    userCredentialForm.env_overrides = result?.env_overrides || ''
  } catch (error: any) {
    toast.error(t('settings.mcp.loadCredentialFailed') + ': ' + error.message)
  } finally {
    credentialsLoading.value = false
  }
}

// 保存用户凭证
const saveUserCredential = async () => {
  if (!selectedServer.value) return
  credentialsSaving.value = true
  try {
    const result = await mcpApi.setUserCredential(selectedServer.value.id, {
      env_overrides: userCredentialForm.env_overrides || undefined,
    })
    userCredential.value = result
    toast.success(t('settings.mcp.saveCredentialSuccess'))
  } catch (error: any) {
    toast.error(t('settings.mcp.saveCredentialFailed') + ': ' + error.message)
  } finally {
    credentialsSaving.value = false
  }
}

// 删除用户凭证
const deleteUserCredential = async () => {
  if (!selectedServer.value) return
  try {
    await mcpApi.deleteUserCredential(selectedServer.value.id)
    userCredential.value = null
    userCredentialForm.env_overrides = ''
    toast.success(t('settings.mcp.deleteCredentialSuccess'))
  } catch (error: any) {
    toast.error(t('settings.mcp.deleteCredentialFailed') + ': ' + error.message)
  }
}

// 加载系统默认凭证
const loadDefaultCredential = async (serverId: string) => {
  defaultCredentialLoading.value = true
  try {
    const result = await mcpApi.getDefaultCredentialForServer(serverId)
    defaultCredential.value = result
    defaultCredentialForm.env_overrides = result?.env_overrides || ''
  } catch (error: any) {
    toast.error(t('settings.mcp.loadDefaultCredentialFailed') + ': ' + error.message)
  } finally {
    defaultCredentialLoading.value = false
  }
}

// 保存系统默认凭证
const saveDefaultCredential = async () => {
  if (!selectedServer.value) return
  defaultCredentialSaving.value = true
  try {
    const result = await mcpApi.setDefaultCredential(selectedServer.value.id, {
      env_overrides: defaultCredentialForm.env_overrides || undefined,
    })
    defaultCredential.value = result
    toast.success(t('settings.mcp.saveDefaultCredentialSuccess'))
  } catch (error: any) {
    toast.error(t('settings.mcp.saveDefaultCredentialFailed') + ': ' + error.message)
  } finally {
    defaultCredentialSaving.value = false
  }
}

// 删除系统默认凭证
const deleteDefaultCredential = async () => {
  if (!selectedServer.value) return
  try {
    await mcpApi.deleteDefaultCredential(selectedServer.value.id)
    defaultCredential.value = null
    defaultCredentialForm.env_overrides = ''
    toast.success(t('settings.mcp.deleteDefaultCredentialSuccess'))
  } catch (error: any) {
    toast.error(t('settings.mcp.deleteDefaultCredentialFailed') + ': ' + error.message)
  }
}

// 打开 Server 对话框
const openServerDialog = (server?: McpServer) => {
  if (server) {
    editingServer.value = server
    serverForm.name = server.name
    serverForm.command = server.command
    serverForm.args = server.args || ''
    serverForm.env = server.env || ''
    serverForm.is_public = server.is_public
    serverForm.is_active = server.is_active
  } else {
    editingServer.value = null
    serverForm.name = ''
    serverForm.command = ''
    serverForm.args = ''
    serverForm.env = ''
    serverForm.is_public = false
    serverForm.is_active = true
  }
  showServerDialog.value = true
}

// 关闭 Server 对话框
const closeServerDialog = () => {
  showServerDialog.value = false
  editingServer.value = null
}

// 保存 Server
const saveServer = async () => {
  try {
    if (editingServer.value) {
      const result = await mcpApi.updateServer(editingServer.value.id, {
        name: serverForm.name,
        command: serverForm.command,
        args: serverForm.args || undefined,
        env: serverForm.env || undefined,
        is_public: serverForm.is_public,
        is_active: serverForm.is_active,
      })
      // 更新本地列表
      const index = servers.value.findIndex(s => s.id === editingServer.value!.id)
      if (index !== -1) {
        servers.value[index] = result
      }
      // 如果当前选中的是被编辑的 Server，更新选中状态
      if (selectedServer.value?.id === editingServer.value.id) {
        selectedServer.value = result
      }
      toast.success(t('settings.mcp.saveServerSuccess'))
    } else {
      const result = await mcpApi.createServer({
        name: serverForm.name,
        command: serverForm.command,
        args: serverForm.args || undefined,
        env: serverForm.env || undefined,
        is_public: serverForm.is_public,
        is_active: serverForm.is_active,
      })
      servers.value.push(result)
      // 自动选中新创建的 Server
      selectedServer.value = result
      toast.success(t('settings.mcp.createServerSuccess'))
    }
    closeServerDialog()
  } catch (error: any) {
    toast.error(t('settings.mcp.saveServerFailed') + ': ' + error.message)
  }
}

// 从对话框内确认删除
const confirmDeleteServerFromDialog = () => {
  if (editingServer.value) {
    deletingServer.value = editingServer.value
    showDeleteServerDialog.value = true
  }
}

// 关闭删除确认对话框
const closeDeleteServerDialog = () => {
  showDeleteServerDialog.value = false
  deletingServer.value = null
}

// 删除 Server
const deleteServer = async () => {
  if (!deletingServer.value) return
  try {
    await mcpApi.deleteServer(deletingServer.value.id)
    // 从列表中移除
    servers.value = servers.value.filter(s => s.id !== deletingServer.value!.id)
    // 如果删除的是当前选中的 Server，清空选择
    if (selectedServer.value?.id === deletingServer.value.id) {
      selectedServer.value = null
    }
    closeDeleteServerDialog()
    closeServerDialog()
    toast.success(t('settings.mcp.deleteServerSuccess'))
  } catch (error: any) {
    toast.error(t('settings.mcp.deleteServerFailed') + ': ' + error.message)
  }
}

// 初始化
onMounted(async () => {
  await loadServers()
})
</script>

<style scoped>
.mcp-tab {
  display: flex;
  gap: 20px;
  padding: 20px;
  height: calc(100vh - 200px);
}

.panel {
  background: var(--card-bg, #fff);
  border-radius: 8px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.server-panel {
  width: 300px;
  flex-shrink: 0;
}

.detail-panel {
  flex: 1;
  min-width: 0;
}

.panel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px 20px;
  background: var(--bg-secondary, #f8f9fa);
  border-bottom: 1px solid var(--border-light, #eee);
}

.panel-title {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  color: var(--text-primary, #333);
}

.btn-icon-add {
  width: 28px;
  height: 28px;
  border: 1px solid var(--border-color, #ddd);
  border-radius: 6px;
  background: var(--bg-secondary, #f5f5f5);
  color: var(--text-secondary, #666);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s;
}

.btn-icon-add:hover {
  background: var(--primary-color, #2196f3);
  color: white;
  border-color: var(--primary-color, #2196f3);
}

.icon {
  font-size: 16px;
  font-weight: bold;
}

.loading-state,
.empty-state {
  text-align: center;
  padding: 40px;
  color: var(--text-secondary, #666);
}

.empty-icon {
  font-size: 48px;
  margin-bottom: 16px;
}

.server-list-container {
  flex: 1;
  overflow-y: auto;
  padding: 10px;
}

.server-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.server-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  background: var(--bg-secondary, #f8f9fa);
  border-radius: 6px;
  border: 1px solid var(--border-light, #eee);
  transition: all 0.2s;
}

.server-item:hover {
  background: var(--bg-tertiary, #eee);
}

.server-item.active {
  border-color: var(--primary-color, #2196f3);
  background: rgba(33, 150, 243, 0.1);
}

.server-item.inactive {
  opacity: 0.6;
}

.server-name-btn {
  display: flex;
  align-items: center;
  gap: 8px;
  background: none;
  border: none;
  cursor: pointer;
  padding: 0;
  color: var(--text-primary, #333);
  font-size: 14px;
}

.server-name {
  font-weight: 500;
}

.badge {
  padding: 2px 8px;
  font-size: 11px;
  border-radius: 4px;
}

.badge.inactive {
  background: #f5f5f5;
  color: #616161;
}

.badge.public {
  background: #e8f5e9;
  color: #2e7d32;
}

.btn-edit {
  padding: 4px 12px;
  font-size: 12px;
  border: 1px solid var(--border-color, #ddd);
  border-radius: 4px;
  background: var(--bg-secondary, #f5f5f5);
  color: var(--text-secondary, #666);
  cursor: pointer;
  transition: all 0.2s;
}

.btn-edit:hover {
  background: var(--bg-tertiary, #eee);
}

.btn-edit.btn-inactive {
  opacity: 0.6;
}

.select-server-hint {
  color: var(--text-tertiary, #999);
}

.mcp-sub-tabs {
  display: flex;
  gap: 8px;
  padding: 12px 20px;
  background: var(--bg-secondary, #f8f9fa);
  border-bottom: 1px solid var(--border-light, #eee);
}

.sub-tab-btn {
  padding: 8px 16px;
  font-size: 13px;
  border: 1px solid var(--border-color, #ddd);
  border-radius: 6px;
  background: var(--bg-secondary, #f5f5f5);
  color: var(--text-secondary, #666);
  cursor: pointer;
  transition: all 0.2s;
}

.sub-tab-btn:hover {
  background: var(--bg-tertiary, #eee);
}

.sub-tab-btn.active {
  background: var(--primary-color, #2196f3);
  color: white;
  border-color: var(--primary-color, #2196f3);
}

.detail-tab-content {
  flex: 1;
  overflow-y: auto;
  padding: 20px;
}

.toolbar {
  display: flex;
  justify-content: flex-end;
  margin-bottom: 16px;
}

.btn-refresh {
  padding: 8px 16px;
  font-size: 14px;
  border: 1px solid var(--border-color, #ddd);
  border-radius: 6px;
  background: var(--bg-secondary, #f5f5f5);
  color: var(--text-secondary, #666);
  cursor: pointer;
  transition: all 0.2s;
}

.btn-refresh:hover:not(:disabled) {
  background: var(--bg-tertiary, #eee);
}

.btn-refresh:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.tools-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.tool-item {
  padding: 16px;
  background: var(--bg-secondary, #f8f9fa);
  border-radius: 6px;
  border: 1px solid var(--border-light, #eee);
}

.tool-info {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.tool-name {
  font-size: 14px;
  font-weight: 500;
  color: var(--text-primary, #333);
  font-family: monospace;
}

.tool-description {
  font-size: 13px;
  color: var(--text-secondary, #666);
  margin: 0;
}

.credential-form {
  max-width: 600px;
}

.form-item {
  margin-bottom: 16px;
}

.form-label {
  display: block;
  font-size: 14px;
  font-weight: 500;
  color: var(--text-primary, #333);
  margin-bottom: 8px;
}

.form-input {
  width: 100%;
  padding: 10px 12px;
  font-size: 14px;
  border: 1px solid var(--border-color, #ddd);
  border-radius: 6px;
  background: var(--input-bg, #fff);
  color: var(--text-primary, #333);
  resize: vertical;
}

.form-input:focus {
  outline: none;
  border-color: var(--primary-color, #2196f3);
}

.form-hint {
  font-size: 12px;
  color: var(--text-tertiary, #999);
  margin: 4px 0 0 0;
}

.form-item.checkbox {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.form-item.checkbox .form-label {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 0;
}

.form-item.checkbox input[type="checkbox"] {
  width: 16px;
  height: 16px;
}

.form-actions {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
}

.btn-save {
  padding: 8px 16px;
  font-size: 14px;
  border: none;
  border-radius: 6px;
  background: var(--primary-color, #2196f3);
  color: white;
  cursor: pointer;
  transition: all 0.2s;
}

.btn-save:hover:not(:disabled) {
  background: #1976d2;
}

.btn-save:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-delete-small {
  padding: 8px 16px;
  font-size: 14px;
  border: 1px solid #f44336;
  border-radius: 6px;
  background: #ffebee;
  color: #c62828;
  cursor: pointer;
  transition: all 0.2s;
}

.btn-delete-small:hover {
  background: #ffcdd2;
}

/* Dialog styles */
.dialog-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  justify-content: center;
  align-items: center;
  z-index: 1000;
}

.dialog {
  background: var(--card-bg, #fff);
  border-radius: 8px;
  padding: 24px;
  max-width: 500px;
  width: 90%;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
}

.dialog.dialog-confirm {
  max-width: 400px;
}

.dialog-title {
  margin: 0 0 20px 0;
  font-size: 18px;
  color: var(--text-primary, #333);
}

.dialog-body {
  margin-bottom: 24px;
}

.dialog-footer {
  display: flex;
  justify-content: space-between;
}

.footer-left,
.footer-right {
  display: flex;
  gap: 12px;
}

.btn-cancel {
  padding: 8px 16px;
  font-size: 14px;
  border: 1px solid var(--border-color, #ddd);
  border-radius: 6px;
  background: var(--bg-secondary, #f5f5f5);
  color: var(--text-secondary, #666);
  cursor: pointer;
}

.btn-confirm {
  padding: 8px 16px;
  font-size: 14px;
  border: none;
  border-radius: 6px;
  background: var(--primary-color, #2196f3);
  color: white;
  cursor: pointer;
}

.btn-confirm:hover:not(:disabled) {
  background: #1976d2;
}

.btn-confirm:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-confirm.delete {
  background: #f44336;
}

.btn-confirm.delete:hover {
  background: #d32f2f;
}

.btn-delete {
  padding: 8px 16px;
  font-size: 14px;
  border: 1px solid #f44336;
  border-radius: 6px;
  background: #ffebee;
  color: #c62828;
  cursor: pointer;
}

.btn-delete:hover {
  background: #ffcdd2;
}

.dialog-message {
  font-size: 14px;
  color: var(--text-secondary, #666);
  margin: 0;
}
</style>