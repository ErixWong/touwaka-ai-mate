<template>
  <div class="invitation-tab">
    <!-- 顶部配额栏 - 紧凑设计 -->
    <div class="quota-bar">
      <div class="quota-stats">
        <div class="quota-stat">
          <span class="stat-value">{{ quota.remaining }}</span>
          <span class="stat-label">{{ $t('invitation.quotaRemaining') }}</span>
        </div>
        <div class="quota-divider">/</div>
        <div class="quota-stat">
          <span class="stat-value">{{ quota.quota }}</span>
          <span class="stat-label">{{ $t('invitation.quotaTotal') }}</span>
        </div>
        <div class="quota-stat used">
          <span class="stat-value">{{ quota.used }}</span>
          <span class="stat-label">{{ $t('invitation.quotaUsed') }}</span>
        </div>
      </div>
      <button
        class="btn-create"
        :disabled="quota.remaining <= 0 || creating"
        @click="handleCreateInvitation"
      >
        <span class="btn-icon">+</span>
        {{ creating ? $t('common.loading') : $t('invitation.createCode') }}
      </button>
    </div>

    <!-- 邀请码列表 -->
    <div class="list-container">
      <div v-if="loading" class="loading-state">
        {{ $t('common.loading') }}
      </div>

      <div v-else-if="invitations.length === 0" class="empty-state">
        <span class="empty-icon">🎫</span>
        <span>{{ $t('invitation.noCodes') }}</span>
      </div>

      <div v-else class="invitations-table">
        <!-- 表头 -->
        <div class="table-header">
          <span class="col-code">{{ $t('invitation.code') }}</span>
          <span class="col-status">{{ $t('invitation.statusLabel') }}</span>
          <span class="col-usage">{{ $t('invitation.usage') }}</span>
          <span class="col-expiry">{{ $t('invitation.expiry') }}</span>
          <span class="col-link">{{ $t('invitation.inviteLink') }}</span>
          <span class="col-actions">{{ $t('common.actions') }}</span>
        </div>

        <!-- 列表项 -->
        <div
          v-for="invitation in invitations"
          :key="invitation.id"
          class="invitation-row"
          :class="{ expired: invitation.status !== 'active' }"
        >
          <div class="col-code">
            <code class="code-text" @click="copyInviteLink(invitation.code)">{{ invitation.code }}</code>
          </div>
          <div class="col-status">
            <span :class="['status-dot', invitation.status]"></span>
            <span :class="['status-text', invitation.status]">
              {{ $t(`invitation.status.${invitation.status}`) }}
            </span>
          </div>
          <div class="col-usage">
            <span class="usage-text">{{ invitation.usedCount }}/{{ invitation.maxUses }}</span>
            <button
              v-if="invitation.usedCount > 0"
              class="btn-view-mini"
              @click="showUsage(invitation)"
              :title="$t('invitation.viewUsage')"
            >
              👥
            </button>
          </div>
          <div class="col-expiry">
            <span v-if="invitation.expiresAt" class="expiry-text">{{ formatDateShort(invitation.expiresAt) }}</span>
            <span v-else class="expiry-text never">—</span>
          </div>
          <div class="col-link">
            <span class="link-text" :title="getInviteLink(invitation.code)">{{ getInviteLink(invitation.code) }}</span>
          </div>
          <div class="col-actions">
            <button
              class="btn-icon-action copy"
              :title="$t('invitation.copyLink')"
              @click="copyInviteLink(invitation.code)"
            >
              📋
            </button>
            <button
              v-if="invitation.status === 'active'"
              class="btn-icon-action revoke"
              :title="$t('invitation.revoke')"
              @click="handleRevoke(invitation)"
            >
              🚫
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- 使用记录弹窗 -->
    <div v-if="showUsageModal" class="modal-overlay" @click.self="closeUsageModal">
      <div class="modal-content">
        <div class="modal-header">
          <h3>{{ $t('invitation.usageTitle') }} - {{ currentInvitation?.code }}</h3>
          <button class="btn-close" @click="closeUsageModal">×</button>
        </div>
        <div class="modal-body">
          <div v-if="usageLoading" class="loading-state">
            {{ $t('common.loading') }}
          </div>
          <div v-else-if="usageList.length === 0" class="empty-state">
            {{ $t('invitation.noUsage') }}
          </div>
          <div v-else class="usage-list">
            <div
              v-for="usage in usageList"
              :key="usage.userId"
              class="usage-item"
            >
              <div class="usage-user">
                <span class="username">{{ usage.username }}</span>
                <span v-if="usage.nickname" class="nickname">({{ usage.nickname }})</span>
              </div>
              <div class="usage-time">
                {{ formatDate(usage.usedAt) }}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  getInvitationQuota,
  getInvitations,
  createInvitation,
  revokeInvitation,
  getInvitationUsage,
  type InvitationQuota,
  type Invitation,
  type InvitationUsage,
} from '@/api/invitation'

const { t } = useI18n()

const quota = ref<InvitationQuota>({ quota: 0, used: 0, remaining: 0 })
const invitations = ref<Invitation[]>([])
const loading = ref(true)
const creating = ref(false)

const showUsageModal = ref(false)
const usageLoading = ref(false)
const usageList = ref<InvitationUsage[]>([])
const currentInvitation = ref<Invitation | null>(null)

// 加载数据
onMounted(async () => {
  await loadData()
})

const loadData = async () => {
  loading.value = true
  try {
    const [quotaData, invitationsData] = await Promise.all([
      getInvitationQuota(),
      getInvitations(),
    ])
    quota.value = quotaData
    invitations.value = invitationsData.items
  } catch (err) {
    console.error('Failed to load invitation data:', err)
    const errorMsg = err instanceof Error ? err.message : t('invitation.loadError')
    alert(errorMsg)
  } finally {
    loading.value = false
  }
}

// 创建邀请码
const handleCreateInvitation = async () => {
  creating.value = true
  try {
    await createInvitation()
    alert(t('invitation.createSuccess'))
    await loadData()
  } catch (err: any) {
    const errorMsg = err.response?.data?.message || t('invitation.createError')
    alert(errorMsg)
  } finally {
    creating.value = false
  }
}

// 获取邀请链接
const getInviteLink = (code: string) => {
  const baseUrl = window.location.origin
  return `${baseUrl}/register?code=${code}`
}

// 复制邀请链接
const copyInviteLink = async (code: string) => {
  const link = getInviteLink(code)

  try {
    await navigator.clipboard.writeText(link)
    alert(t('invitation.copySuccess'))
  } catch (err) {
    console.error('Failed to copy:', err)
    alert(t('invitation.copyError'))
  }
}

// 撤销邀请码
const handleRevoke = async (invitation: Invitation) => {
  if (!confirm(t('invitation.revokeConfirm'))) {
    return
  }

  try {
    await revokeInvitation(invitation.id)
    alert(t('invitation.revokeSuccess'))
    await loadData()
  } catch (err: any) {
    const errorMsg = err.response?.data?.message || t('invitation.revokeError')
    alert(errorMsg)
  }
}

// 显示使用记录
const showUsage = async (invitation: Invitation) => {
  currentInvitation.value = invitation
  showUsageModal.value = true
  usageLoading.value = true
  usageList.value = []

  try {
    const result = await getInvitationUsage(invitation.id)
    usageList.value = result.items
  } catch (err) {
    console.error('Failed to load usage:', err)
    const errorMsg = err instanceof Error ? err.message : t('invitation.usageLoadError')
    alert(errorMsg)
  } finally {
    usageLoading.value = false
  }
}

// 关闭使用记录弹窗
const closeUsageModal = () => {
  showUsageModal.value = false
  currentInvitation.value = null
  usageList.value = []
}

// 格式化日期 - 短格式
const formatDateShort = (dateStr: string) => {
  const date = new Date(dateStr)
  const now = new Date()
  const diffDays = Math.floor((date.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))

  if (diffDays === 0) return t('invitation.expiresToday')
  if (diffDays === 1) return t('invitation.expiresTomorrow')
  if (diffDays < 0) return t('invitation.expired')
  if (diffDays < 30) return t('invitation.expiresInDays', { days: diffDays })

  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

// 格式化日期 - 完整格式
const formatDate = (dateStr: string) => {
  const date = new Date(dateStr)
  return date.toLocaleString()
}
</script>

<style scoped>
.invitation-tab {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}

/* 顶部配额栏 - 紧凑设计 */
.quota-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  border-radius: 8px;
  margin: 12px 16px;
  flex-shrink: 0;
}

.quota-stats {
  display: flex;
  align-items: center;
  gap: 12px;
}

.quota-stat {
  display: flex;
  flex-direction: column;
  align-items: center;
  min-width: 50px;
}

.quota-stat.used {
  opacity: 0.7;
}

.stat-value {
  font-size: 20px;
  font-weight: 700;
  color: white;
  line-height: 1;
}

.stat-label {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.8);
  margin-top: 2px;
}

.quota-divider {
  color: rgba(255, 255, 255, 0.4);
  font-size: 14px;
}

.btn-create {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 16px;
  background: white;
  color: #667eea;
  border: none;
  border-radius: 6px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
}

.btn-create:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow: 0 4px 8px rgba(0, 0, 0, 0.15);
}

.btn-create:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-icon {
  font-size: 16px;
  font-weight: 700;
}

/* 列表容器 - 可滚动 */
.list-container {
  flex: 1;
  overflow-y: auto;
  padding: 0 16px 16px;
}

.loading-state,
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 48px 24px;
  color: #888;
  gap: 12px;
}

.empty-icon {
  font-size: 48px;
  opacity: 0.5;
}

/* 表格样式 */
.invitations-table {
  display: flex;
  flex-direction: column;
  gap: 1px;
  background: #e8e8e8;
  border-radius: 8px;
  overflow: hidden;
}

.table-header {
  display: grid;
  grid-template-columns: 100px 70px 60px 90px 1fr 70px;
  gap: 8px;
  padding: 10px 12px;
  background: #f5f5f5;
  font-size: 12px;
  font-weight: 600;
  color: #666;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.invitation-row {
  display: grid;
  grid-template-columns: 100px 70px 60px 90px 1fr 70px;
  gap: 8px;
  padding: 10px 12px;
  background: white;
  align-items: center;
  transition: background 0.15s;
}

.invitation-row:hover {
  background: #fafafa;
}

.invitation-row.expired {
  opacity: 0.6;
}

/* 列样式 */
.col-code {
  overflow: hidden;
}

.code-text {
  font-family: 'SF Mono', Monaco, monospace;
  font-size: 13px;
  font-weight: 600;
  color: #333;
  background: #f0f0f0;
  padding: 4px 8px;
  border-radius: 4px;
  cursor: pointer;
  transition: background 0.2s;
  display: inline-block;
}

.code-text:hover {
  background: #e0e0e0;
}

.col-status {
  display: flex;
  align-items: center;
  gap: 6px;
}

.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}

.status-dot.active {
  background: #4caf50;
}

.status-dot.exhausted {
  background: #ff9800;
}

.status-dot.expired {
  background: #f44336;
}

.status-dot.revoked {
  background: #9e9e9e;
}

.status-text {
  font-size: 12px;
  font-weight: 500;
}

.status-text.active {
  color: #4caf50;
}

.status-text.exhausted {
  color: #ff9800;
}

.status-text.expired {
  color: #f44336;
}

.status-text.revoked {
  color: #9e9e9e;
}

.col-usage {
  display: flex;
  align-items: center;
  gap: 6px;
}

.usage-text {
  font-size: 12px;
  color: #666;
  font-weight: 500;
}

.btn-view-mini {
  width: 20px;
  height: 20px;
  border: none;
  background: transparent;
  cursor: pointer;
  font-size: 12px;
  padding: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
  transition: background 0.2s;
}

.btn-view-mini:hover {
  background: #f0f0f0;
}

.col-expiry {
  font-size: 12px;
  color: #666;
}

.expiry-text.never {
  color: #aaa;
}

.col-link {
  overflow: hidden;
  min-width: 0;
}

.link-text {
  font-size: 11px;
  color: #666;
  font-family: 'SF Mono', Monaco, monospace;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  display: block;
  cursor: pointer;
  padding: 4px 8px;
  background: #f8f9fa;
  border-radius: 4px;
  transition: background 0.2s;
}

.link-text:hover {
  background: #e9ecef;
}

.col-actions {
  display: flex;
  gap: 4px;
  justify-content: flex-end;
}

.btn-icon-action {
  width: 28px;
  height: 28px;
  border: none;
  border-radius: 6px;
  background: transparent;
  cursor: pointer;
  font-size: 14px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s;
}

.btn-icon-action:hover {
  background: #f0f0f0;
  transform: scale(1.1);
}

.btn-icon-action.copy:hover {
  background: #e3f2fd;
}

.btn-icon-action.revoke:hover {
  background: #ffebee;
}

/* Modal */
.modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  padding: 16px;
}

.modal-content {
  background: white;
  border-radius: 12px;
  width: 100%;
  max-width: 480px;
  max-height: 80vh;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
}

.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px 20px;
  border-bottom: 1px solid #eee;
}

.modal-header h3 {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
}

.btn-close {
  width: 32px;
  height: 32px;
  border: none;
  background: none;
  font-size: 24px;
  cursor: pointer;
  color: #999;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 6px;
  transition: all 0.2s;
}

.btn-close:hover {
  background: #f5f5f5;
  color: #333;
}

.modal-body {
  padding: 20px;
  overflow-y: auto;
}

/* Usage List */
.usage-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.usage-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px;
  background: #f8f9fa;
  border-radius: 8px;
}

.usage-user {
  display: flex;
  align-items: center;
  gap: 8px;
}

.username {
  font-weight: 500;
  color: #333;
  font-size: 14px;
}

.nickname {
  color: #888;
  font-size: 13px;
}

.usage-time {
  font-size: 12px;
  color: #888;
}

/* Responsive */
@media (max-width: 768px) {
  .table-header {
    display: none;
  }

  .invitation-row {
    display: grid;
    grid-template-columns: 1fr auto;
    grid-template-rows: auto auto auto;
    gap: 8px;
    padding: 12px;
  }

  .col-code {
    grid-column: 1;
    grid-row: 1;
  }

  .col-status {
    grid-column: 2;
    grid-row: 1;
    justify-content: flex-end;
  }

  .col-usage {
    grid-column: 1;
    grid-row: 2;
  }

  .col-expiry {
    grid-column: 2;
    grid-row: 2;
    text-align: right;
  }

  .col-link {
    grid-column: 1 / -1;
    grid-row: 3;
    padding-top: 8px;
    border-top: 1px dashed #eee;
  }

  .col-actions {
    grid-column: 1 / -1;
    grid-row: 4;
    justify-content: flex-start;
    padding-top: 8px;
    border-top: 1px dashed #eee;
  }

  .link-text {
    font-size: 10px;
  }
}

/* Scrollbar */
.list-container::-webkit-scrollbar {
  width: 6px;
}

.list-container::-webkit-scrollbar-track {
  background: transparent;
}

.list-container::-webkit-scrollbar-thumb {
  background: #ddd;
  border-radius: 3px;
}

.list-container::-webkit-scrollbar-thumb:hover {
  background: #ccc;
}
</style>