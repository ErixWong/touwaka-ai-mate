<template>
  <div class="attachment-tab">
    <div class="panel-header">
      <h3 class="panel-title">{{ $t('settings.attachmentManagement') }}</h3>
    </div>
    <div class="attachment-content">
      <p class="coming-soon">{{ $t('settings.comingSoon') || 'Coming Soon...' }}</p>
    </div>
  </div>
</template>

<script setup lang="ts">
// Attachment management tab - placeholder for future implementation
</script>

<style scoped>
.attachment-tab {
  min-height: 400px;
}

.panel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px 20px;
  border-bottom: 1px solid var(--border-color, #e0e0e0);
  background: var(--card-bg, #fff);
}

.panel-title {
  font-size: 15px;
  font-weight: 600;
  margin: 0;
  color: var(--text-primary, #333);
}

.attachment-content {
  padding: 40px;
  text-align: center;
}

.coming-soon {
  color: var(--text-secondary, #666);
  font-size: 14px;
}
</style>