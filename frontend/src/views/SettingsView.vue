<template>
  <div class="settings-view">
    <h1 class="view-title">{{ $t('settings.title') }}</h1>

    <div class="settings-tabs">
      <button
        v-for="tab in tabs"
        :key="tab.key"
        class="tab-btn"
        :class="{ active: activeTab === tab.key }"
        @click="activeTab = tab.key"
      >
        {{ tab.label }}
      </button>
    </div>

    <!-- 个人资料 -->
    <div v-if="activeTab === 'profile'" class="settings-section">
      <div class="setting-item">
        <label class="setting-label">{{ $t('settings.nickname') }}</label>
        <input
          v-model="profileForm.nickname"
          type="text"
          class="setting-input"
        />
      </div>
      <div class="setting-item">
        <label class="setting-label">{{ $t('settings.language') }}</label>
        <select v-model="profileForm.language" class="setting-select">
          <option value="zh-CN">中文</option>
          <option value="en-US">English</option>
        </select>
      </div>
      <button class="btn-save" @click="saveProfile">{{ $t('settings.save') }}</button>
    </div>

    <!-- 模型和提供商管理（合并） -->
    <div v-if="activeTab === 'model'" class="settings-section model-provider-section">
      <div class="split-panel">
        <!-- 左侧：提供商列表 -->
        <div class="panel provider-panel">
          <div class="panel-header">
            <h3 class="panel-title">{{ $t('settings.providerManagement') }}</h3>
            <button class="btn-icon-add" @click="openProviderDialog()" :title="$t('settings.addProvider')">
              <span class="icon">+</span>
            </button>
          </div>

          <div v-if="providerStore.isLoading" class="loading-state">
            {{ $t('common.loading') }}
          </div>

          <div v-else-if="providerStore.providers.length === 0" class="empty-state">
            {{ $t('settings.noProviders') }}
          </div>

          <div v-else class="provider-list-container">
            <div class="provider-list">
              <div
                v-for="provider in paginatedProviders"
                :key="provider.id"
                class="provider-item"
                :class="{
                  active: selectedProvider?.id === provider.id,
                  inactive: !provider.is_active
                }"
              >
                <button
                  class="provider-name-btn"
                  @click="selectProvider(provider)"
                >
                  <span class="provider-name">{{ provider.name }}</span>
                  <span v-if="!provider.is_active" class="badge inactive">
                    {{ $t('settings.inactive') }}
                  </span>
                </button>
                <button
                  class="btn-edit"
                  :class="{ 'btn-inactive': !provider.is_active }"
                  @click.stop="openProviderDialog(provider)"
                  :title="$t('common.edit')"
                >
                  {{ $t('common.edit') }}
                </button>
              </div>
            </div>

            <!-- 提供商分页 -->
            <div v-if="providerTotalPages > 1" class="pagination">
              <button
                class="page-btn"
                :disabled="providerPage === 1"
                @click="providerPage--"
              >
                <
              </button>
              <span class="page-info">{{ providerPage }} / {{ providerTotalPages }}</span>
              <button
                class="page-btn"
                :disabled="providerPage === providerTotalPages"
                @click="providerPage++"
              >
                >
              </button>
            </div>
          </div>
        </div>

        <!-- 右侧：模型列表 -->
        <div class="panel model-panel">
          <div class="panel-header">
            <h3 class="panel-title">
              {{ selectedProvider 
                ? $t('settings.modelsOfProvider', { name: selectedProvider.name }) 
                : $t('settings.modelManagement') 
              }}
            </h3>
            <button
              v-if="selectedProvider"
              class="btn-icon-add"
              @click="openModelDialog()"
              :title="$t('settings.addModel')"
            >
              <span class="icon">+</span>
            </button>
          </div>

          <div v-if="!selectedProvider" class="empty-state select-provider-hint">
            {{ $t('settings.selectProviderHint') }}
          </div>

          <div v-else-if="modelStore.isLoading" class="loading-state">
            {{ $t('common.loading') }}
          </div>

          <div v-else-if="filteredModels.length === 0" class="empty-state">
            {{ $t('settings.noModelsForProvider') }}
          </div>

          <div v-else class="model-list-container">
            <div class="model-list">
              <div
                v-for="model in paginatedModels"
                :key="model.id"
                class="model-item"
                :class="{
                  inactive: !model.is_active
                }"
              >
                <div class="model-info">
                  <span class="model-name">{{ model.name }}</span>
                  <span v-if="!model.is_active" class="badge inactive">
                    {{ $t('settings.inactive') }}
                  </span>
                </div>
                <button
                  class="btn-edit"
                  :class="{ 'btn-inactive': !model.is_active }"
                  @click.stop="openModelDialog(model)"
                  :title="$t('common.edit')"
                >
                  {{ $t('common.edit') }}
                </button>
              </div>
            </div>

            <!-- 模型分页 -->
            <div v-if="modelTotalPages > 1" class="pagination">
              <button
                class="page-btn"
                :disabled="modelPage === 1"
                @click="modelPage--"
              >
                <
              </button>
              <span class="page-info">{{ modelPage }} / {{ modelTotalPages }}</span>
              <button
                class="page-btn"
                :disabled="modelPage === modelTotalPages"
                @click="modelPage++"
              >
                >
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 专家设置 -->
    <div v-if="activeTab === 'expert'" class="settings-section expert-section">
      <div class="panel-header">
        <h3 class="panel-title">{{ $t('settings.expertManagement') }}</h3>
        <button class="btn-icon-add" @click="openExpertDialog()" :title="$t('settings.addExpert')">
          <span class="icon">+</span>
        </button>
      </div>

      <div v-if="expertStore.isLoading" class="loading-state">
        {{ $t('common.loading') }}
      </div>

      <div v-else-if="expertStore.experts.length === 0" class="empty-state">
        {{ $t('settings.noExperts') }}
      </div>

      <div v-else class="expert-list-container">
        <div class="expert-list">
          <div
            v-for="expert in paginatedExperts"
            :key="expert.id"
            class="expert-item"
            :class="{
              inactive: !expert.is_active
            }"
          >
            <div class="expert-header">
              <div class="expert-info">
                <span class="expert-name">{{ expert.name }}</span>
                <span v-if="!expert.is_active" class="badge inactive">
                  {{ $t('settings.inactive') }}
                </span>
              </div>
              <div class="expert-actions">
                <button
                  class="btn-edit"
                  :class="{ 'btn-inactive': !expert.is_active }"
                  @click="openExpertDialog(expert)"
                  :title="$t('common.edit')"
                >
                  {{ $t('common.edit') }}
                </button>
                <button
                  class="btn-delete-small"
                  @click="confirmDeleteExpert(expert)"
                  :title="$t('common.delete')"
                >
                  {{ $t('common.delete') }}
                </button>
              </div>
            </div>
            <p v-if="expert.introduction" class="expert-intro">{{ expert.introduction }}</p>
          </div>
        </div>

        <!-- 专家分页 -->
        <div v-if="expertTotalPages > 1" class="pagination">
          <button
            class="page-btn"
            :disabled="expertPage === 1"
            @click="expertPage--"
          >
            &lt;
          </button>
          <span class="page-info">{{ expertPage }} / {{ expertTotalPages }}</span>
          <button
            class="page-btn"
            :disabled="expertPage === expertTotalPages"
            @click="expertPage++"
          >
            &gt;
          </button>
        </div>
      </div>
    </div>

    <!-- 关于 -->
    <div v-if="activeTab === 'about'" class="settings-section">
      <div class="about-content">
        <h2 class="app-name">{{ $t('app.title') }}</h2>
        <p class="app-version">Version 1.0.0</p>
        <p class="app-description">{{ $t('app.description') }}</p>
      </div>
    </div>

    <!-- Provider 添加/编辑对话框 -->
    <div v-if="showProviderDialog" class="dialog-overlay">
      <div class="dialog">
        <h3 class="dialog-title">
          {{ editingProvider ? $t('settings.editProvider') : $t('settings.addProvider') }}
        </h3>
        <div class="dialog-body">
          <div class="form-item">
            <label class="form-label">{{ $t('settings.providerName') }} *</label>
            <input
              v-model="providerForm.name"
              type="text"
              class="form-input"
              :placeholder="$t('settings.providerNamePlaceholder')"
            />
          </div>
          <div class="form-item">
            <label class="form-label">{{ $t('settings.baseUrl') }} *</label>
            <input
              v-model="providerForm.base_url"
              type="text"
              class="form-input"
              :placeholder="$t('settings.baseUrlPlaceholder')"
            />
          </div>
          <div class="form-item">
            <label class="form-label">{{ $t('settings.apiKey') }}</label>
            <input
              v-model="providerForm.api_key"
              type="password"
              class="form-input"
              :placeholder="$t('settings.apiKeyPlaceholder')"
            />
            <p v-if="editingProvider" class="form-hint">{{ $t('settings.apiKeyHint') }}</p>
          </div>
          <div class="form-item">
            <label class="form-label">{{ $t('settings.timeout') }} (秒)</label>
            <input
              v-model.number="providerForm.timeout"
              type="number"
              class="form-input"
              min="5"
              max="300"
            />
          </div>
          <div class="form-item checkbox">
            <label class="form-label">
              <input v-model="providerForm.is_active" type="checkbox" />
              {{ $t('settings.isActive') }}
            </label>
          </div>
        </div>
        <div class="dialog-footer">
          <div class="footer-left">
            <button
              v-if="editingProvider"
              class="btn-delete"
              @click="confirmDeleteProviderFromDialog"
            >
              {{ $t('common.delete') }}
            </button>
          </div>
          <div class="footer-right">
            <button class="btn-cancel" @click="closeProviderDialog">{{ $t('common.cancel') }}</button>
            <button class="btn-confirm" :disabled="!isProviderFormValid" @click="saveProvider">
              {{ $t('common.save') }}
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- Model 添加/编辑对话框 -->
    <div v-if="showModelDialog" class="dialog-overlay">
      <div class="dialog">
        <h3 class="dialog-title">
          {{ editingModel ? $t('settings.editModel') : $t('settings.addModel') }}
        </h3>
        <div class="dialog-body">
          <div class="form-item">
            <label class="form-label">{{ $t('settings.modelName') }} *</label>
            <input
              v-model="modelForm.name"
              type="text"
              class="form-input"
              :placeholder="$t('settings.modelNamePlaceholder')"
            />
          </div>
          <div class="form-item">
            <label class="form-label">{{ $t('settings.modelIdentifier') }} *</label>
            <input
              v-model="modelForm.model_name"
              type="text"
              class="form-input"
              :placeholder="$t('settings.modelIdentifierPlaceholder')"
            />
            <p class="form-hint">{{ $t('settings.modelIdentifierHint') }}</p>
          </div>
          <div class="form-item">
            <label class="form-label">{{ $t('settings.provider') }} *</label>
            <select v-model="modelForm.provider_id" class="form-input">
              <option value="">{{ $t('settings.selectProvider') }}</option>
              <option v-for="provider in providerStore.providers" :key="provider.id" :value="provider.id">
                {{ provider.name }}
              </option>
            </select>
          </div>
          <div class="form-item">
            <label class="form-label">{{ $t('settings.maxTokens') }}</label>
            <input
              v-model.number="modelForm.max_tokens"
              type="number"
              class="form-input"
              :placeholder="$t('settings.maxTokensPlaceholder')"
            />
          </div>
          <div class="form-item">
            <label class="form-label">{{ $t('settings.costPer1kInput') }} (USD)</label>
            <input
              v-model.number="modelForm.cost_per_1k_input"
              type="number"
              step="0.0001"
              class="form-input"
              :placeholder="$t('settings.costPlaceholder')"
            />
          </div>
          <div class="form-item">
            <label class="form-label">{{ $t('settings.costPer1kOutput') }} (USD)</label>
            <input
              v-model.number="modelForm.cost_per_1k_output"
              type="number"
              step="0.0001"
              class="form-input"
              :placeholder="$t('settings.costPlaceholder')"
            />
          </div>
          <div class="form-item">
            <label class="form-label">{{ $t('settings.modelDescription') }}</label>
            <textarea
              v-model="modelForm.description"
              class="form-input"
              rows="3"
              :placeholder="$t('settings.descriptionPlaceholder')"
            ></textarea>
          </div>
          <div class="form-item checkbox">
            <label class="form-label">
              <input v-model="modelForm.is_active" type="checkbox" />
              {{ $t('settings.isActive') }}
            </label>
          </div>
        </div>
        <div class="dialog-footer">
          <div class="footer-left">
            <button
              v-if="editingModel"
              class="btn-delete"
              @click="confirmDeleteModelFromDialog"
            >
              {{ $t('common.delete') }}
            </button>
          </div>
          <div class="footer-right">
            <button class="btn-cancel" @click="closeModelDialog">{{ $t('common.cancel') }}</button>
            <button class="btn-confirm" :disabled="!isModelFormValid" @click="saveModel">
              {{ $t('common.save') }}
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- Provider 删除确认对话框 -->
    <div v-if="showDeleteProviderDialog" class="dialog-overlay">
      <div class="dialog dialog-confirm">
        <h3 class="dialog-title">{{ $t('common.confirmDelete') }}</h3>
        <p class="dialog-message">
          {{ $t('settings.deleteProviderConfirm', { name: deletingProvider?.name }) }}
        </p>
        <div class="dialog-footer">
          <button class="btn-cancel" @click="closeDeleteProviderDialog">{{ $t('common.cancel') }}</button>
          <button class="btn-confirm delete" @click="deleteProvider">
            {{ $t('common.delete') }}
          </button>
        </div>
      </div>
    </div>

    <!-- Model 删除确认对话框 -->
    <div v-if="showDeleteModelDialog" class="dialog-overlay">
      <div class="dialog dialog-confirm">
        <h3 class="dialog-title">{{ $t('common.confirmDelete') }}</h3>
        <p class="dialog-message">
          {{ $t('settings.deleteModelConfirm', { name: deletingModel?.name }) }}
        </p>
        <div class="dialog-footer">
          <button class="btn-cancel" @click="closeDeleteModelDialog">{{ $t('common.cancel') }}</button>
          <button class="btn-confirm delete" @click="deleteModel">
            {{ $t('common.delete') }}
          </button>
        </div>
      </div>
    </div>

    <!-- Expert 添加/编辑对话框 -->
    <div v-if="showExpertDialog" class="dialog-overlay">
      <div class="dialog dialog-large">
        <h3 class="dialog-title">
          {{ editingExpert ? $t('settings.editExpert') : $t('settings.addExpert') }}
        </h3>
        <div class="dialog-body">
          <div class="form-row">
            <div class="form-item">
              <label class="form-label">{{ $t('settings.expertName') }} *</label>
              <input
                v-model="expertForm.name"
                type="text"
                class="form-input"
                :placeholder="$t('settings.expertNamePlaceholder')"
              />
            </div>
            <div class="form-item checkbox">
              <label class="form-label">
                <input v-model="expertForm.is_active" type="checkbox" />
                {{ $t('settings.isActive') }}
              </label>
            </div>
          </div>
          
          <div class="form-row avatar-row">
            <div class="form-item avatar-item">
              <label class="form-label">{{ $t('settings.expertAvatar') }}</label>
              <div class="avatar-upload">
                <div 
                  class="avatar-preview" 
                  :style="expertForm.avatar_base64 ? { backgroundImage: `url(${expertForm.avatar_base64})` } : {}"
                >
                  <span v-if="!expertForm.avatar_base64">🤖</span>
                </div>
                <div class="avatar-actions">
                  <input
                    type="file"
                    accept="image/*"
                    ref="smallAvatarInput"
                    @change="handleSmallAvatarUpload"
                    style="display: none"
                  />
                  <button type="button" class="btn-small" @click="smallAvatarInput?.click()">
                    {{ $t('settings.uploadAvatar') }}
                  </button>
                  <button 
                    v-if="expertForm.avatar_base64" 
                    type="button" 
                    class="btn-small btn-danger"
                    @click="expertForm.avatar_base64 = ''"
                  >
                    {{ $t('common.delete') }}
                  </button>
                </div>
              </div>
            </div>
            <div class="form-item avatar-item">
              <label class="form-label">{{ $t('settings.expertAvatarLarge') }}</label>
              <div class="avatar-upload">
                <div 
                  class="avatar-preview large" 
                  :style="expertForm.avatar_large_base64 ? { backgroundImage: `url(${expertForm.avatar_large_base64})` } : {}"
                >
                  <span v-if="!expertForm.avatar_large_base64">🖼️</span>
                </div>
                <div class="avatar-actions">
                  <input
                    type="file"
                    accept="image/*"
                    ref="largeAvatarInput"
                    @change="handleLargeAvatarUpload"
                    style="display: none"
                  />
                  <button type="button" class="btn-small" @click="largeAvatarInput?.click()">
                    {{ $t('settings.uploadAvatar') }}
                  </button>
                  <button 
                    v-if="expertForm.avatar_large_base64" 
                    type="button" 
                    class="btn-small btn-danger"
                    @click="expertForm.avatar_large_base64 = ''"
                  >
                    {{ $t('common.delete') }}
                  </button>
                </div>
              </div>
            </div>
          </div>
          
          <div class="form-item">
            <label class="form-label">{{ $t('settings.expertIntroduction') }}</label>
            <textarea
              v-model="expertForm.introduction"
              class="form-input"
              rows="2"
              :placeholder="$t('settings.expertIntroductionPlaceholder')"
            ></textarea>
          </div>
          
          <div class="form-row">
            <div class="form-item">
              <label class="form-label">{{ $t('settings.expertSpeakingStyle') }}</label>
              <input
                v-model="expertForm.speaking_style"
                type="text"
                class="form-input"
                :placeholder="$t('settings.expertSpeakingStylePlaceholder')"
              />
            </div>
            <div class="form-item">
              <label class="form-label">{{ $t('settings.expertEmotionalTone') }}</label>
              <input
                v-model="expertForm.emotional_tone"
                type="text"
                class="form-input"
                :placeholder="$t('settings.expertEmotionalTonePlaceholder')"
              />
            </div>
          </div>
          
          <div class="form-item">
            <label class="form-label">{{ $t('settings.expertCoreValues') }}</label>
            <textarea
              v-model="expertForm.core_values"
              class="form-input"
              rows="2"
              :placeholder="$t('settings.expertCoreValuesPlaceholder')"
            ></textarea>
          </div>
          
          <div class="form-item">
            <label class="form-label">{{ $t('settings.expertBehavioralGuidelines') }}</label>
            <textarea
              v-model="expertForm.behavioral_guidelines"
              class="form-input"
              rows="3"
              :placeholder="$t('settings.expertBehavioralGuidelinesPlaceholder')"
            ></textarea>
          </div>
          
          <div class="form-item">
            <label class="form-label">{{ $t('settings.expertTaboos') }}</label>
            <textarea
              v-model="expertForm.taboos"
              class="form-input"
              rows="2"
              :placeholder="$t('settings.expertTaboosPlaceholder')"
            ></textarea>
          </div>
          
          <div class="form-row">
            <div class="form-item">
              <label class="form-label">{{ $t('settings.expertExpressiveModel') }}</label>
              <select v-model="expertForm.expressive_model_id" class="form-input">
                <option value="">{{ $t('settings.selectModel') }}</option>
                <option v-for="model in modelStore.models" :key="model.id" :value="model.id">
                  {{ model.name }}
                </option>
              </select>
            </div>
            <div class="form-item">
              <label class="form-label">{{ $t('settings.expertReflectiveModel') }}</label>
              <select v-model="expertForm.reflective_model_id" class="form-input">
                <option value="">{{ $t('settings.selectModel') }}</option>
                <option v-for="model in modelStore.models" :key="model.id" :value="model.id">
                  {{ model.name }}
                </option>
              </select>
            </div>
          </div>
          
          <div class="form-item">
            <label class="form-label">{{ $t('settings.expertPromptTemplate') }}</label>
            <textarea
              v-model="expertForm.prompt_template"
              class="form-input"
              rows="4"
              :placeholder="$t('settings.expertPromptTemplatePlaceholder')"
            ></textarea>
          </div>
          
          <!-- 上下文压缩配置 -->
          <div class="form-section-title">{{ $t('settings.contextCompression') }}</div>
          <div class="form-item">
            <label class="form-label">{{ $t('settings.contextThreshold') }}</label>
            <input
              v-model.number="expertForm.context_threshold"
              type="number"
              class="form-input"
              step="0.05"
              min="0.3"
              max="0.95"
            />
            <p class="form-hint">{{ $t('settings.contextThresholdHint') }}</p>
          </div>
          
          <!-- LLM 参数配置 -->
          <div class="form-section-title">{{ $t('settings.llmParams') }}</div>
          <div class="form-row">
            <div class="form-item">
              <label class="form-label">{{ $t('settings.temperature') }}</label>
              <input
                v-model.number="expertForm.temperature"
                type="number"
                class="form-input"
                step="0.1"
                min="0"
                max="2"
              />
              <p class="form-hint">{{ $t('settings.temperatureHint') }}</p>
            </div>
            <div class="form-item">
              <label class="form-label">{{ $t('settings.reflectiveTemperature') }}</label>
              <input
                v-model.number="expertForm.reflective_temperature"
                type="number"
                class="form-input"
                step="0.1"
                min="0"
                max="2"
              />
              <p class="form-hint">{{ $t('settings.reflectiveTemperatureHint') }}</p>
            </div>
          </div>
          <div class="form-row">
            <div class="form-item">
              <label class="form-label">{{ $t('settings.topP') }}</label>
              <input
                v-model.number="expertForm.top_p"
                type="number"
                class="form-input"
                step="0.1"
                min="0"
                max="1"
              />
              <p class="form-hint">{{ $t('settings.topPHint') }}</p>
            </div>
            <div class="form-item">
              <label class="form-label">{{ $t('settings.frequencyPenalty') }}</label>
              <input
                v-model.number="expertForm.frequency_penalty"
                type="number"
                class="form-input"
                step="0.1"
                min="-2"
                max="2"
              />
              <p class="form-hint">{{ $t('settings.frequencyPenaltyHint') }}</p>
            </div>
          </div>
          <div class="form-row">
            <div class="form-item">
              <label class="form-label">{{ $t('settings.presencePenalty') }}</label>
              <input
                v-model.number="expertForm.presence_penalty"
                type="number"
                class="form-input"
                step="0.1"
                min="-2"
                max="2"
              />
              <p class="form-hint">{{ $t('settings.presencePenaltyHint') }}</p>
            </div>
            <div class="form-item">
              <!-- 占位符，保持布局对称 -->
            </div>
          </div>
        </div>
        <div class="dialog-footer">
          <div class="footer-left">
            <button
              v-if="editingExpert"
              class="btn-delete"
              @click="confirmDeleteExpertFromDialog"
            >
              {{ $t('common.delete') }}
            </button>
          </div>
          <div class="footer-right">
            <button class="btn-cancel" @click="closeExpertDialog">{{ $t('common.cancel') }}</button>
            <button class="btn-confirm" :disabled="!isExpertFormValid" @click="saveExpert">
              {{ $t('common.save') }}
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- Expert 删除确认对话框 -->
    <div v-if="showDeleteExpertDialog" class="dialog-overlay">
      <div class="dialog dialog-confirm">
        <h3 class="dialog-title">{{ $t('common.confirmDelete') }}</h3>
        <p class="dialog-message">
          {{ $t('settings.deleteExpertConfirm', { name: deletingExpert?.name }) }}
        </p>
        <div class="dialog-footer">
          <button class="btn-cancel" @click="closeDeleteExpertDialog">{{ $t('common.cancel') }}</button>
          <button class="btn-confirm delete" @click="deleteExpert">
            {{ $t('common.delete') }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted, computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useUserStore } from '@/stores/user'
import { useModelStore } from '@/stores/model'
import { useProviderStore } from '@/stores/provider'
import { useExpertStore } from '@/stores/expert'
import { compressSmallAvatar, compressLargeAvatar } from '@/utils/imageCompress'
import type { AIModel, ModelProvider, ProviderFormData, ModelFormData, Expert } from '@/types'

const { t, locale } = useI18n()
const userStore = useUserStore()
const modelStore = useModelStore()
const providerStore = useProviderStore()
const expertStore = useExpertStore()

const activeTab = ref('profile')

const tabs = computed(() => [
  { key: 'profile', label: t('settings.profile') },
  { key: 'model', label: t('settings.modelAndProvider') },
  { key: 'expert', label: t('settings.expertSettings') },
  { key: 'about', label: t('settings.about') },
])

const profileForm = reactive({
  nickname: '',
  language: 'zh-CN',
})

// 专家分页
const expertPage = ref(1)
const EXPERT_PAGE_SIZE = 10

const expertTotalPages = computed(() =>
  Math.ceil(expertStore.experts.length / EXPERT_PAGE_SIZE)
)

const paginatedExperts = computed(() => {
  const start = (expertPage.value - 1) * EXPERT_PAGE_SIZE
  return expertStore.experts.slice(start, start + EXPERT_PAGE_SIZE)
})

// Provider 选择
const selectedProvider = ref<ModelProvider | null>(null)
const providerPage = ref(1)
const PROVIDER_PAGE_SIZE = 10

// Provider 分页
const providerTotalPages = computed(() =>
  Math.ceil(providerStore.providers.length / PROVIDER_PAGE_SIZE)
)

const paginatedProviders = computed(() => {
  const start = (providerPage.value - 1) * PROVIDER_PAGE_SIZE
  return providerStore.providers.slice(start, start + PROVIDER_PAGE_SIZE)
})

// 选择提供商
const selectProvider = (provider: ModelProvider) => {
  selectedProvider.value = provider
  modelPage.value = 1 // 重置模型分页
}

// 模型分页
const modelPage = ref(1)
const MODEL_PAGE_SIZE = 10

// 过滤属于选中提供商的模型
const filteredModels = computed(() => {
  if (!selectedProvider.value) return []
  return modelStore.models.filter(m => m.provider_id === selectedProvider.value!.id)
})

const modelTotalPages = computed(() =>
  Math.ceil(filteredModels.value.length / MODEL_PAGE_SIZE)
)

const paginatedModels = computed(() => {
  const start = (modelPage.value - 1) * MODEL_PAGE_SIZE
  return filteredModels.value.slice(start, start + MODEL_PAGE_SIZE)
})

// Provider 对话框
const showProviderDialog = ref(false)
const editingProvider = ref<ModelProvider | null>(null)
const providerForm = reactive<ProviderFormData>({
  name: '',
  base_url: '',
  api_key: '',
  timeout: 30,
  is_active: true,
})

const isProviderFormValid = computed(() => {
  return providerForm.name.trim() && providerForm.base_url.trim()
})

// Provider 删除对话框
const showDeleteProviderDialog = ref(false)
const deletingProvider = ref<ModelProvider | null>(null)

// Model 对话框
const showModelDialog = ref(false)
const editingModel = ref<AIModel | null>(null)
const modelForm = reactive<ModelFormData>({
  name: '',
  model_name: '',
  provider_id: '',
  max_tokens: undefined,
  cost_per_1k_input: undefined,
  cost_per_1k_output: undefined,
  description: '',
  is_active: true,
})

const isModelFormValid = computed(() => {
  return modelForm.name?.trim() && modelForm.model_name?.trim() && modelForm.provider_id?.trim()
})

// Model 删除对话框
const showDeleteModelDialog = ref(false)
const deletingModel = ref<AIModel | null>(null)

// Expert 对话框
const showExpertDialog = ref(false)
const editingExpert = ref<Expert | null>(null)
const expertForm = reactive({
  name: '',
  introduction: '',
  speaking_style: '',
  core_values: '',
  behavioral_guidelines: '',
  taboos: '',
  emotional_tone: '',
  expressive_model_id: '',
  reflective_model_id: '',
  prompt_template: '',
  // 上下文压缩配置
  context_threshold: 0.70,
  // LLM 参数配置
  temperature: 0.70,
  reflective_temperature: 0.30,
  top_p: 1.0,
  frequency_penalty: 0.0,
  presence_penalty: 0.0,
  // 头像
  avatar_base64: '',
  avatar_large_base64: '',
  is_active: true,
})

const isExpertFormValid = computed(() => {
  return expertForm.name?.trim()
})

// Expert 删除对话框
const showDeleteExpertDialog = ref(false)
const deletingExpert = ref<Expert | null>(null)

// 头像上传 ref
const smallAvatarInput = ref<HTMLInputElement | null>(null)
const largeAvatarInput = ref<HTMLInputElement | null>(null)

const saveProfile = async () => {
  await userStore.updatePreferences({
    language: profileForm.language as 'zh-CN' | 'en-US',
  })
  locale.value = profileForm.language
}

// Provider 管理方法
const openProviderDialog = (provider?: ModelProvider) => {
  if (provider) {
    editingProvider.value = provider
    providerForm.name = provider.name
    providerForm.base_url = provider.base_url
    providerForm.api_key = '' // 编辑时不显示原有 API Key
    providerForm.timeout = provider.timeout
    providerForm.is_active = provider.is_active
  } else {
    editingProvider.value = null
    providerForm.name = ''
    providerForm.base_url = ''
    providerForm.api_key = ''
    providerForm.timeout = 30
    providerForm.is_active = true
  }
  showProviderDialog.value = true
}

const closeProviderDialog = () => {
  showProviderDialog.value = false
  editingProvider.value = null
}

const saveProvider = async () => {
  try {
    if (editingProvider.value) {
      // 更新 - 只发送有值的字段
      const updateData: Partial<ProviderFormData> = {
        name: providerForm.name,
        base_url: providerForm.base_url,
        timeout: providerForm.timeout,
        is_active: providerForm.is_active,
      }
      if (providerForm.api_key) {
        updateData.api_key = providerForm.api_key
      }
      await providerStore.updateProvider(editingProvider.value.id, updateData)
    } else {
      // 创建
      const newProvider = await providerStore.createProvider({ ...providerForm })
      // 自动选中新创建的提供商
      selectedProvider.value = newProvider
    }
    closeProviderDialog()
  } catch (err) {
    // 错误已在 store 中处理
  }
}

const confirmDeleteProviderFromDialog = () => {
  if (editingProvider.value) {
    deletingProvider.value = editingProvider.value
    showDeleteProviderDialog.value = true
  }
}

const closeDeleteProviderDialog = () => {
  showDeleteProviderDialog.value = false
  deletingProvider.value = null
}

const deleteProvider = async () => {
  if (!deletingProvider.value) return
  try {
    await providerStore.deleteProvider(deletingProvider.value.id)
    // 如果删除的是当前选中的提供商，清空选择
    if (selectedProvider.value?.id === deletingProvider.value.id) {
      selectedProvider.value = null
    }
    closeDeleteProviderDialog()
    closeProviderDialog()
  } catch (err) {
    // 错误已在 store 中处理
  }
}

// Model 管理方法
const openModelDialog = (model?: AIModel) => {
  if (model) {
    editingModel.value = model
    modelForm.name = model.name
    modelForm.model_name = model.model_name || ''
    modelForm.provider_id = model.provider_id || ''
    modelForm.max_tokens = model.max_tokens
    modelForm.cost_per_1k_input = model.cost_per_1k_input
    modelForm.cost_per_1k_output = model.cost_per_1k_output
    modelForm.description = model.description || ''
    modelForm.is_active = model.is_active
  } else {
    editingModel.value = null
    modelForm.name = ''
    modelForm.model_name = ''
    // 如果已选择提供商，默认使用该提供商
    modelForm.provider_id = selectedProvider.value?.id || ''
    modelForm.max_tokens = undefined
    modelForm.cost_per_1k_input = undefined
    modelForm.cost_per_1k_output = undefined
    modelForm.description = ''
    modelForm.is_active = true
  }
  showModelDialog.value = true
}

const closeModelDialog = () => {
  showModelDialog.value = false
  editingModel.value = null
}

const saveModel = async () => {
  try {
    if (editingModel.value) {
      await modelStore.updateModel(editingModel.value.id, { ...modelForm })
    } else {
      await modelStore.createModel({ ...modelForm })
    }
    closeModelDialog()
  } catch (err) {
    // 错误已在 store 中处理
  }
}

const confirmDeleteModelFromDialog = () => {
  if (editingModel.value) {
    deletingModel.value = editingModel.value
    showDeleteModelDialog.value = true
  }
}

const closeDeleteModelDialog = () => {
  showDeleteModelDialog.value = false
  deletingModel.value = null
}

const deleteModel = async () => {
  if (!deletingModel.value) return
  try {
    await modelStore.deleteModel(deletingModel.value.id)
    closeDeleteModelDialog()
    closeModelDialog()
  } catch (err) {
    // 错误已在 store 中处理
  }
}

// Expert 管理方法
const openExpertDialog = (expert?: Expert) => {
  if (expert) {
    editingExpert.value = expert
    expertForm.name = expert.name
    expertForm.introduction = expert.introduction || ''
    expertForm.speaking_style = expert.speaking_style || ''
    expertForm.core_values = expert.core_values || ''
    expertForm.behavioral_guidelines = expert.behavioral_guidelines || ''
    expertForm.taboos = expert.taboos || ''
    expertForm.emotional_tone = expert.emotional_tone || ''
    expertForm.expressive_model_id = expert.expressive_model_id || ''
    expertForm.reflective_model_id = expert.reflective_model_id || ''
    expertForm.prompt_template = expert.prompt_template || ''
    expertForm.context_threshold = expert.context_threshold ?? 0.70
    // LLM 参数
    expertForm.temperature = expert.temperature ?? 0.70
    expertForm.reflective_temperature = expert.reflective_temperature ?? 0.30
    expertForm.top_p = expert.top_p ?? 1.0
    expertForm.frequency_penalty = expert.frequency_penalty ?? 0.0
    expertForm.presence_penalty = expert.presence_penalty ?? 0.0
    // 头像
    expertForm.avatar_base64 = expert.avatar_base64 || ''
    expertForm.avatar_large_base64 = expert.avatar_large_base64 || ''
    expertForm.is_active = expert.is_active
  } else {
    editingExpert.value = null
    expertForm.name = ''
    expertForm.introduction = ''
    expertForm.speaking_style = ''
    expertForm.core_values = ''
    expertForm.behavioral_guidelines = ''
    expertForm.taboos = ''
    expertForm.emotional_tone = ''
    expertForm.expressive_model_id = ''
    expertForm.reflective_model_id = ''
    expertForm.prompt_template = ''
    expertForm.context_threshold = 0.70
    // LLM 参数默认值
    expertForm.temperature = 0.70
    expertForm.reflective_temperature = 0.30
    expertForm.top_p = 1.0
    expertForm.frequency_penalty = 0.0
    expertForm.presence_penalty = 0.0
    // 头像
    expertForm.avatar_base64 = ''
    expertForm.avatar_large_base64 = ''
    expertForm.is_active = true
  }
  showExpertDialog.value = true
}

const closeExpertDialog = () => {
  showExpertDialog.value = false
  editingExpert.value = null
}

const saveExpert = async () => {
  try {
    // 直接提交字符串数据
    if (editingExpert.value) {
      await expertStore.updateExpert(editingExpert.value.id, { ...expertForm })
    } else {
      await expertStore.createExpert({ ...expertForm })
    }
    closeExpertDialog()
  } catch (err) {
    // 错误已在 store 中处理
  }
}

const handleSmallAvatarUpload = async (event: Event) => {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  
  try {
    const result = await compressSmallAvatar(file)
    expertForm.avatar_base64 = result.base64
    console.log(`小头像压缩: ${Math.round(result.originalSize / 1024)}KB → ${Math.round(result.compressedSize / 1024)}KB`)
  } catch (err) {
    console.error('压缩小头像失败:', err)
    alert(err instanceof Error ? err.message : t('settings.imageProcessFailed'))
  }
  input.value = ''
}

const handleLargeAvatarUpload = async (event: Event) => {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  
  try {
    const result = await compressLargeAvatar(file)
    expertForm.avatar_large_base64 = result.base64
    console.log(`大头像压缩: ${Math.round(result.originalSize / 1024)}KB → ${Math.round(result.compressedSize / 1024)}KB`)
  } catch (err) {
    console.error('压缩大头像失败:', err)
    alert(err instanceof Error ? err.message : t('settings.imageProcessFailed'))
  }
  input.value = ''
}

const confirmDeleteExpert = (expert: Expert) => {
  deletingExpert.value = expert
  showDeleteExpertDialog.value = true
}

const confirmDeleteExpertFromDialog = () => {
  if (editingExpert.value) {
    deletingExpert.value = editingExpert.value
    showDeleteExpertDialog.value = true
  }
}

const closeDeleteExpertDialog = () => {
  showDeleteExpertDialog.value = false
  deletingExpert.value = null
}

const deleteExpert = async () => {
  if (!deletingExpert.value) return
  try {
    await expertStore.deleteExpert(deletingExpert.value.id)
    closeDeleteExpertDialog()
    closeExpertDialog()
  } catch (err) {
    // 错误已在 store 中处理
  }
}

// 监听提供商列表变化，如果当前选中的提供商被删除，清空选择
watch(() => providerStore.providers, (newProviders) => {
  if (selectedProvider.value && !newProviders.find(p => p.id === selectedProvider.value!.id)) {
    selectedProvider.value = null
  }
}, { deep: true })

onMounted(() => {
  // 加载用户设置
  if (userStore.user) {
    profileForm.nickname = userStore.user.nickname || ''
    profileForm.language = userStore.preferences?.language || 'zh-CN'
  }
  // 加载模型列表
  modelStore.loadModels()
  // 加载 Provider 列表
  providerStore.loadProviders()
  // 加载所有专家列表（包括非活跃的）
  expertStore.loadExperts({})
})
</script>

<style scoped>
.settings-view {
  padding: 24px;
  width: 80%;
  max-width: 1200px;
  margin: 0 auto;
}

.view-title {
  font-size: 24px;
  font-weight: 600;
  margin: 0 0 24px 0;
  color: var(--text-primary, #333);
}

.settings-tabs {
  display: flex;
  gap: 4px;
  margin-bottom: 24px;
  border-bottom: 1px solid var(--border-color, #e0e0e0);
}

.tab-btn {
  padding: 12px 20px;
  background: none;
  border: none;
  font-size: 14px;
  color: var(--text-secondary, #666);
  cursor: pointer;
  border-bottom: 2px solid transparent;
  transition: all 0.2s;
}

.tab-btn:hover {
  color: var(--text-primary, #333);
}

.tab-btn.active {
  color: var(--primary-color, #2196f3);
  border-bottom-color: var(--primary-color, #2196f3);
}

.settings-section {
  padding: 24px;
  background: var(--card-bg, #fff);
  border: 1px solid var(--border-color, #e0e0e0);
  border-radius: 12px;
}

/* 模型和提供商合并区域 */
.model-provider-section {
  padding: 0;
  overflow: hidden;
}

.split-panel {
  display: flex;
  min-height: 500px;
}

.panel {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.provider-panel {
  flex: 0 0 320px;
  border-right: 1px solid var(--border-color, #e0e0e0);
  background: var(--secondary-bg, #f8f9fa);
}

.model-panel {
  flex: 1;
  background: var(--card-bg, #fff);
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

.btn-icon-add {
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--primary-color, #2196f3);
  color: white;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  font-size: 18px;
  line-height: 1;
  transition: background 0.2s;
}

.btn-icon-add:hover {
  background: var(--primary-hover, #1976d2);
}

.provider-list-container,
.model-list-container {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.provider-list,
.model-list {
  flex: 1;
  overflow-y: auto;
  padding: 8px;
}

.provider-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  margin-bottom: 4px;
  border-radius: 8px;
  background: var(--card-bg, #fff);
  border: 1px solid transparent;
  transition: all 0.2s;
}

.provider-item:hover {
  background: var(--hover-bg, #e8e8e8);
}

.provider-item.active {
  background: var(--primary-light, #e3f2fd);
  border-color: var(--primary-color, #2196f3);
}

.provider-item.inactive {
  opacity: 0.6;
}

.provider-name-btn {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 8px;
  background: none;
  border: none;
  text-align: left;
  cursor: pointer;
  padding: 4px;
  min-width: 0;
}

.provider-name {
  font-size: 14px;
  font-weight: 500;
  color: var(--text-primary, #333);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.model-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 16px;
  margin-bottom: 4px;
  border-radius: 8px;
  background: var(--secondary-bg, #f5f5f5);
  border: 1px solid transparent;
  transition: all 0.2s;
  cursor: pointer;
}

.model-item:hover {
  background: var(--hover-bg, #e8e8e8);
}

.model-item.inactive {
  opacity: 0.6;
}

.model-info {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.model-name {
  font-size: 14px;
  font-weight: 500;
  color: var(--text-primary, #333);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.badge {
  padding: 2px 8px;
  font-size: 11px;
  border-radius: 4px;
  font-weight: 500;
  flex-shrink: 0;
}

.badge.inactive {
  background: var(--error-bg, #ffebee);
  color: var(--error-color, #c62828);
}

.btn-edit {
  padding: 4px 10px;
  background: white;
  border: 1px solid var(--border-color, #e0e0e0);
  border-radius: 6px;
  font-size: 12px;
  color: var(--text-secondary, #666);
  cursor: pointer;
  flex-shrink: 0;
  transition: all 0.2s;
}

.btn-edit:hover {
  background: var(--hover-bg, #e8e8e8);
  border-color: var(--primary-color, #2196f3);
  color: var(--primary-color, #2196f3);
}

.btn-edit.btn-inactive {
  border-color: var(--error-color, #c62828);
  color: var(--error-color, #c62828);
}

.btn-edit.btn-inactive:hover {
  background: var(--error-bg, #ffebee);
  border-color: var(--error-color, #c62828);
  color: var(--error-color, #c62828);
}

/* 分页 */
.pagination {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 12px;
  border-top: 1px solid var(--border-color, #e0e0e0);
  background: var(--card-bg, #fff);
}

.page-btn {
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: white;
  border: 1px solid var(--border-color, #e0e0e0);
  border-radius: 6px;
  font-size: 14px;
  color: var(--text-primary, #333);
  cursor: pointer;
  transition: all 0.2s;
}

.page-btn:hover:not(:disabled) {
  background: var(--hover-bg, #e8e8e8);
  border-color: var(--primary-color, #2196f3);
}

.page-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.page-info {
  font-size: 13px;
  color: var(--text-secondary, #666);
  min-width: 60px;
  text-align: center;
}

/* 空状态和加载状态 */
.loading-state,
.empty-state {
  padding: 40px;
  text-align: center;
  color: var(--text-secondary, #666);
  font-size: 14px;
}

.select-provider-hint {
  color: var(--text-tertiary, #999);
  font-style: italic;
}

/* 表单样式 */
.setting-item {
  margin-bottom: 20px;
}

.setting-item.checkbox {
  display: flex;
  align-items: center;
}

.setting-item.checkbox .setting-label {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
}

.setting-label {
  display: block;
  font-size: 13px;
  font-weight: 500;
  color: var(--text-secondary, #666);
  margin-bottom: 8px;
}

.setting-input,
.setting-select {
  width: 100%;
  padding: 10px 12px;
  border: 1px solid var(--border-color, #e0e0e0);
  border-radius: 8px;
  font-size: 14px;
}

.setting-input:focus,
.setting-select:focus {
  outline: none;
  border-color: var(--primary-color, #2196f3);
}

.btn-save {
  padding: 10px 24px;
  background: var(--primary-color, #2196f3);
  color: white;
  border: none;
  border-radius: 8px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
}

.btn-save:hover {
  background: var(--primary-hover, #1976d2);
}

/* Dialog */
.dialog-overlay {
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

.dialog {
  background: white;
  border-radius: 12px;
  width: 100%;
  max-width: 480px;
  max-height: 90vh;
  overflow: hidden;
  box-shadow: 0 4px 24px rgba(0, 0, 0, 0.15);
}

.dialog-large {
  max-width: 720px;
}

.dialog-confirm {
  max-width: 400px;
}

.dialog-title {
  font-size: 18px;
  font-weight: 600;
  margin: 0;
  padding: 20px 24px;
  border-bottom: 1px solid var(--border-color, #e0e0e0);
  color: var(--text-primary, #333);
}

.dialog-body {
  padding: 24px;
  overflow-y: auto;
  max-height: 60vh;
}

.dialog-message {
  padding: 24px;
  margin: 0;
  color: var(--text-secondary, #666);
}

.dialog-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px 24px;
  border-top: 1px solid var(--border-color, #e0e0e0);
}

.footer-left {
  display: flex;
}

.footer-right {
  display: flex;
  gap: 12px;
}

.form-row {
  display: flex;
  gap: 16px;
}

.form-row .form-item {
  flex: 1;
}

.form-item {
  margin-bottom: 16px;
}

.form-item.checkbox {
  display: flex;
  align-items: center;
}

.form-item.checkbox .form-label {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 0;
  cursor: pointer;
}

.form-section-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary, #333);
  margin: 20px 0 12px 0;
  padding-top: 16px;
  border-top: 1px dashed var(--border-color, #e0e0e0);
}

.form-label {
  display: block;
  font-size: 13px;
  font-weight: 500;
  color: var(--text-secondary, #666);
  margin-bottom: 6px;
}

.form-input {
  width: 100%;
  padding: 10px 12px;
  border: 1px solid var(--border-color, #e0e0e0);
  border-radius: 8px;
  font-size: 14px;
}

.form-input:focus {
  outline: none;
  border-color: var(--primary-color, #2196f3);
}

.form-hint {
  font-size: 12px;
  color: var(--text-tertiary, #999);
  margin: 6px 0 0 0;
}

.btn-cancel {
  padding: 8px 16px;
  background: white;
  border: 1px solid var(--border-color, #e0e0e0);
  border-radius: 8px;
  font-size: 14px;
  color: var(--text-secondary, #666);
  cursor: pointer;
}

.btn-cancel:hover {
  background: var(--secondary-bg, #f5f5f5);
}

.btn-confirm {
  padding: 8px 16px;
  background: var(--primary-color, #2196f3);
  color: white;
  border: none;
  border-radius: 8px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
}

.btn-confirm:hover:not(:disabled) {
  background: var(--primary-hover, #1976d2);
}

.btn-confirm:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-confirm.delete {
  background: var(--error-color, #c62828);
}

.btn-confirm.delete:hover {
  background: var(--error-hover, #b71c1c);
}

.btn-delete {
  padding: 8px 16px;
  background: white;
  border: 1px solid var(--error-color, #c62828);
  border-radius: 8px;
  font-size: 14px;
  color: var(--error-color, #c62828);
  cursor: pointer;
  transition: all 0.2s;
}

.btn-delete:hover {
  background: var(--error-bg, #ffebee);
}

/* 专家设置区域 */
.expert-section {
  padding: 0;
  overflow: hidden;
}

.expert-section .panel-header {
  padding: 16px 20px;
  border-bottom: 1px solid var(--border-color, #e0e0e0);
  background: var(--card-bg, #fff);
}

.expert-list-container {
  display: flex;
  flex-direction: column;
  min-height: 400px;
}

.expert-list {
  flex: 1;
  padding: 16px;
}

.expert-item {
  padding: 16px;
  margin-bottom: 12px;
  border-radius: 10px;
  background: var(--secondary-bg, #f8f9fa);
  border: 1px solid transparent;
  transition: all 0.2s;
}

.expert-item:hover {
  background: var(--hover-bg, #e8e8e8);
  border-color: var(--border-color, #e0e0e0);
}

.expert-item.inactive {
  opacity: 0.6;
}

.expert-info {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}

.expert-name {
  font-size: 15px;
  font-weight: 600;
  color: var(--text-primary, #333);
}

.expert-intro {
  font-size: 13px;
  color: var(--text-secondary, #666);
  margin: 0 0 8px 0;
  line-height: 1.5;
}

.expert-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}

.expert-actions {
  display: flex;
  gap: 8px;
}

.btn-delete-small {
  padding: 4px 10px;
  background: white;
  border: 1px solid var(--error-color, #c62828);
  border-radius: 6px;
  font-size: 12px;
  color: var(--error-color, #c62828);
  cursor: pointer;
  transition: all 0.2s;
}

.btn-delete-small:hover {
  background: var(--error-bg, #ffebee);
}

/* About */
.about-content {
  text-align: center;
}

.app-name {
  font-size: 24px;
  font-weight: 600;
  margin: 0 0 8px 0;
  color: var(--text-primary, #333);
}

.app-version {
  font-size: 14px;
  color: var(--text-secondary, #666);
  margin: 0 0 16px 0;
}

.app-description {
  font-size: 14px;
  color: var(--text-secondary, #666);
  margin: 0;
}

/* 响应式 */
@media (max-width: 1024px) {
  .settings-view {
    width: 95%;
    padding: 16px;
  }
}

@media (max-width: 768px) {
  .settings-view {
    width: 100%;
    padding: 12px;
  }

  .split-panel {
    flex-direction: column;
  }

  .provider-panel {
    flex: none;
    width: 100%;
    border-right: none;
    border-bottom: 1px solid var(--border-color, #e0e0e0);
    max-height: 300px;
  }

  .model-panel {
    flex: none;
    width: 100%;
    max-height: 400px;
  }

  .dialog-footer {
    flex-direction: column;
    gap: 12px;
  }

  .footer-left,
  .footer-right {
    width: 100%;
    justify-content: center;
  }
}

.avatar-row {
  align-items: flex-start;
}

.avatar-item {
  flex: 1;
}

.avatar-upload {
  display: flex;
  align-items: center;
  gap: 16px;
}

.avatar-preview {
  width: 64px;
  height: 64px;
  border-radius: 50%;
  background: var(--secondary-bg, #f8f9fa);
  border: 2px dashed var(--border-color, #e0e0e0);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 28px;
  background-size: cover;
  background-position: center;
  flex-shrink: 0;
}

.avatar-preview.large {
  width: 100px;
  height: 100px;
  border-radius: 12px;
  font-size: 36px;
}

.avatar-actions {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.btn-small {
  padding: 6px 12px;
  font-size: 12px;
  border-radius: 6px;
  border: 1px solid var(--border-color, #e0e0e0);
  background: var(--card-bg, #fff);
  color: var(--text-primary, #333);
  cursor: pointer;
  transition: all 0.2s;
  white-space: nowrap;
}

.btn-small:hover {
  background: var(--hover-bg, #e8e8e8);
}

.btn-small.btn-danger {
  color: var(--error-color, #c62828);
  border-color: var(--error-color, #c62828);
}

.btn-small.btn-danger:hover {
  background: var(--error-color, #c62828);
  color: white;
}
</style>
