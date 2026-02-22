<template>
  <div class="not-found-view">
    <div class="error-code">404</div>
    <h1 class="error-title">{{ $t('error.pageNotFound') }}</h1>
    <p class="error-desc">{{ $t('error.pageNotFoundDesc') }}</p>
    <router-link :to="{ name: 'home' }" class="btn-back">
      {{ $t('error.backToHome') }}
    </router-link>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'

const { t } = useI18n()
</script>

<style scoped>
.not-found-view {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 100vh;
  padding: 24px;
  background: var(--main-bg, #f5f5f5);
  text-align: center;
}

.error-code {
  font-size: 120px;
  font-weight: 700;
  color: var(--primary-color, #2196f3);
  line-height: 1;
  margin-bottom: 16px;
  opacity: 0.5;
}

.error-title {
  font-size: 24px;
  font-weight: 600;
  color: var(--text-primary, #333);
  margin: 0 0 8px 0;
}

.error-desc {
  font-size: 14px;
  color: var(--text-secondary, #666);
  margin: 0 0 24px 0;
}

.btn-back {
  padding: 12px 24px;
  background: var(--primary-color, #2196f3);
  color: white;
  text-decoration: none;
  border-radius: 8px;
  font-size: 14px;
  font-weight: 500;
  transition: background 0.2s;
}

.btn-back:hover {
  background: var(--primary-hover, #1976d2);
}
</style>
