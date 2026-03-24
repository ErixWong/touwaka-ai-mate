<template>
  <div class="invitation-tab">
    <!-- 邀请配额卡片 -->
    <div class="quota-card">
      <h3 class="card-title">{{ $t('invitation.quotaTitle') }}</h3>
      <div class="quota-info">
        <div class="quota-item">
          <span class="quota-label">{{ $t('invitation.quotaTotal') }}</span>
          <span class="quota-value">{{ quota.quota }}</span>
        </div>
        <div class="quota-item">
          <span class="quota-label">{{ $t('invitation.quotaUsed') }}</span>
          <span class="quota-value">{{ quota.used }}</span>
        </div>
        <div class="quota-item">
          <span class="quota-label">{{ $t('invitation.quotaRemaining') }}</span>
          <span class="quota-value remaining">{{ quota.remaining }}</span>
        </div>
      </div>
      <button
        class="btn-create"
        :disabled="quota.remaining <= 0 || creating"
        @click="handleCreateInvitation"
      >
        {{ creating ? $t('common.loading') : $t('invitation.createCode') }}
      </button>
    </div>

    <!-- 邀请码列表 -->
    <div class="invitations-card">
      <h3 class="card-title">{{ $t('invitation.myCodes') }}</h3>
      
      <div v-if="loading" class="loading-state">
        {{ $t('common.loading') }}
      </div>
      
      <div v-else-if="invitations.length === 0" class="empty-state">
        {{ $t('invitation.noCodes') }}
      </div>
      
      <div v-else class="invitations-list">
        <div
          v-for="invitation in invitations"
          :key="invitation.id"
          class="invitation-item"
        >
          <div class="invitation-main">
            <div class="invitation-code">
              <span class="code-label">{{ invitation.code }}</span>
              <span :class="['status-badge', invitation.status]">
                {{ $t(`invitation.status.${invitation.status}`) }}
              </span>
            </div>
            <div class="invitation-meta">
              <span>{{ $t('invitation.usedCount', { used: invitation.usedCount, max: invitation.maxUses }) }}</span>
              <span v-if="invitation.expiresAt">
                {{ $t('invitation.expiresAt', { date: formatDate(invitation.expiresAt) }) }}
              </span>
              <span v-else>{{ $t('invitation.neverExpires') }}</span>
            </div>
          </div>
          <div class="invitation-actions">
            <button
              class="btn-action copy"
              :title="$t('invitation.copyLink')"
              @click="copyInviteLink(invitation.code)"
            >
              📋
            </button>
            <button
              v-if="invitation.status === 'active'"
              class="btn-action revoke"
              :title="$t('invitation.revoke')"
              @click="handleRevoke(invitation)"
            >
              ❌
            </button>
            <button
              class="btn-action view"
              :title="$t('invitation.viewUsage')"
              @click="showUsage(invitation)"
            >
              👥
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- 链接显示弹窗 -->
    <div v-if="showLinkModal" class="modal-overlay" @click.self="closeLinkModal">
      <div class="modal-content link-modal">
        <div class="modal-header">
          <h3>{{ $t('invitation.inviteLink') }}</h3>
          <button class="btn-close" @click="closeLinkModal">×</button>
        </div>
        <div class="modal-body">
          <p class="link-hint">{{ $t('invitation.linkHint') }}</p>
          <div class="link-display">
            <input
              ref="linkInputRef"
              type="text"
              :value="currentLink"
              readonly
              class="link-input"
              @click="selectLink"
            />
          </div>
        </div>
      </div>
    </div>

    <!-- 使用记录弹窗 -->
    <div v-if="showUsageModal" class="modal-overlay" @click.self="closeUsageModal">
      <div class="modal-content">
        <div class="modal-header">
          <h3>{{ $t('invitation.usageTitle') }}</h3>
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
import { ref, onMounted, nextTick } from 'vue'
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

// 链接显示弹窗
const showLinkModal = ref(false)
const currentLink = ref('')
const linkInputRef = ref<HTMLInputElement | null>(null)

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

// 复制邀请链接
const copyInviteLink = async (code: string) => {
  const baseUrl = window.location.origin
  const link = `${baseUrl}/register?code=${code}`
  
  try {
    await navigator.clipboard.writeText(link)
    alert(t('invitation.copySuccess'))
  } catch (err) {
    // 剪贴板被禁用时，显示链接弹窗让用户手动复制
    currentLink.value = link
    showLinkModal.value = true
    nextTick(() => {
      // 自动选中链接文本
      if (linkInputRef.value) {
        linkInputRef.value.select()
      }
    })
  }
}

// 选中链接文本
const selectLink = () => {
  if (linkInputRef.value) {
    linkInputRef.value.select()
  }
}

// 关闭链接弹窗
const closeLinkModal = () => {
  showLinkModal.value = false
  currentLink.value = ''
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

// 格式化日期
const formatDate = (dateStr: string) => {
  const date = new Date(dateStr)
  return date.toLocaleString()
}
</script>

<style scoped>
.invitation-tab {
  padding: 0;
}

.quota-card,
.invitations-card {
  background: white;
  border-radius: 12px;
  padding: 24px;
  margin-bottom: 24px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
}

.card-title {
  font-size: 18px;
  font-weight: 600;
  margin: 0 0 16px 0;
  color: #333;
}

.quota-info {
  display: flex;
  gap: 32px;
  margin-bottom: 20px;
}

.quota-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.quota-label {
  font-size: 13px;
  color: #666;
}

.quota-value {
  font-size: 24px;
  font-weight: 600;
  color: #333;
}

.quota-value.remaining {
  color: #4caf50;
}

.btn-create {
  padding: 10px 24px;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
  border: none;
  border-radius: 8px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: opacity 0.2s;
}

.btn-create:hover:not(:disabled) {
  opacity: 0.9;
}

.btn-create:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.loading-state,
.empty-state {
  text-align: center;
  padding: 40px;
  color: #666;
}

.invitations-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.invitation-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px;
  background: #f8f9fa;
  border-radius: 8px;
}

.invitation-main {
  flex: 1;
}

.invitation-code {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 8px;
}

.code-label {
  font-family: monospace;
  font-size: 16px;
  font-weight: 600;
  color: #333;
}

.status-badge {
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 12px;
  font-weight: 500;
}

.status-badge.active {
  background: #e8f5e9;
  color: #2e7d32;
}

.status-badge.exhausted {
  background: #fff3e0;
  color: #e65100;
}

.status-badge.expired {
  background: #fce4ec;
  color: #c2185b;
}

.status-badge.revoked {
  background: #f5f5f5;
  color: #757575;
}

.invitation-meta {
  display: flex;
  gap: 16px;
  font-size: 13px;
  color: #666;
}

.invitation-actions {
  display: flex;
  gap: 8px;
}

.btn-action {
  width: 36px;
  height: 36px;
  border: none;
  border-radius: 8px;
  background: white;
  cursor: pointer;
  font-size: 16px;
  transition: background 0.2s;
}

.btn-action:hover {
  background: #e0e0e0;
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
}

.modal-content {
  background: white;
  border-radius: 12px;
  width: 100%;
  max-width: 500px;
  max-height: 80vh;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px 24px;
  border-bottom: 1px solid #eee;
}

.modal-header h3 {
  margin: 0;
  font-size: 18px;
}

.btn-close {
  width: 32px;
  height: 32px;
  border: none;
  background: none;
  font-size: 24px;
  cursor: pointer;
  color: #666;
}

.btn-close:hover {
  color: #333;
}

.modal-body {
  padding: 24px;
  overflow-y: auto;
}

.usage-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
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
}

.nickname {
  color: #666;
  font-size: 13px;
}

.usage-time {
  font-size: 13px;
  color: #666;
}

/* Link Modal */
.link-modal {
  max-width: 550px;
}

.link-hint {
  margin: 0 0 16px 0;
  color: #666;
  font-size: 14px;
}

.link-display {
  display: flex;
  gap: 8px;
}

.link-input {
  flex: 1;
  padding: 12px 16px;
  border: 2px solid #e0e0e0;
  border-radius: 8px;
  font-family: monospace;
  font-size: 14px;
  background: #f8f9fa;
  color: #333;
  cursor: pointer;
  transition: border-color 0.2s;
}

.link-input:hover {
  border-color: #667eea;
}

.link-input:focus {
  outline: none;
  border-color: #667eea;
}
</style>