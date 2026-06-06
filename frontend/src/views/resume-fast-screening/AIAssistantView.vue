<script setup lang="ts">
</script>

<template>
  <div class="ai-assistant">
    <div class="page-header">
      <h2 class="page-title">{{ $t('resumeScreening.ai.title') }} <el-tag size="small" type="warning">{{ $t('resumeScreening.ai.beta') }}</el-tag></h2>
    </div>

    <div class="placeholder-content">
      <div class="feature-card">
        <div class="feature-icon">📧</div>
        <div class="feature-info">
          <h4>{{ $t('resumeScreening.ai.emailDraft') }}</h4>
          <p>{{ $t('resumeScreening.ai.emailDraftDesc') }}</p>
          <el-button disabled>{{ $t('resumeScreening.ai.comingSoon') }}</el-button>
        </div>
      </div>

      <div class="feature-card">
        <div class="feature-icon">🔄</div>
        <div class="feature-info">
          <h4>{{ $t('resumeScreening.ai.replyParse') }}</h4>
          <p>{{ $t('resumeScreening.ai.replyParseDesc') }}</p>
          <div class="flow-steps">
            <span class="step">📨 {{ $t('resumeScreening.ai.flowReplyText') }}</span>
            <span class="arrow">→</span>
            <span class="step">🤖 {{ $t('resumeScreening.ai.flowParseText') }}</span>
            <span class="arrow">→</span>
            <span class="step">📝 {{ $t('resumeScreening.ai.flowFillText') }}</span>
            <span class="arrow">→</span>
            <span class="step">✅ {{ $t('resumeScreening.ai.flowConfirmText') }}</span>
          </div>
          <el-button disabled>{{ $t('resumeScreening.ai.comingSoon') }}</el-button>
        </div>
      </div>

      <div class="beta-notice">
        <el-alert
          :title="$t('resumeScreening.ai.betaNoticeTitle')"
          type="info"
          :closable="false"
          :description="$t('resumeScreening.ai.betaNoticeDesc')"
          show-icon
        />
      </div>
    </div>
  </div>
</template>

<style scoped>
.page-header { margin-bottom: 24px; display: flex; align-items: center; gap: 8px; }
.page-title { font-size: 20px; }
.placeholder-content { display: flex; flex-direction: column; gap: 16px; max-width: 700px; }
.feature-card { display: flex; gap: 16px; padding: 20px; border: 1px solid var(--el-border-color-lighter); border-radius: 8px; background: var(--el-fill-color-lighter); }
.feature-icon { font-size: 36px; }
.feature-info h4 { margin: 0 0 8px; font-size: 15px; }
.feature-info p { margin: 0 0 12px; font-size: 13px; color: var(--el-text-color-secondary); }
.flow-steps { display: flex; align-items: center; gap: 8px; margin-bottom: 12px; font-size: 13px; }
.arrow { color: var(--el-text-color-placeholder); }
.beta-notice { margin-top: 8px; }
</style>
