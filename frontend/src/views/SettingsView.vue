<template>
  <div class="settings-view">
    <!-- 左侧菜单 -->
    <el-menu
      :default-active="activeTab"
      :collapse="sidebarCollapsed"
      class="settings-sidebar"
      @select="handleMenuSelect"
    >
      <el-menu-item
        v-for="item in currentMenuItems"
        :key="item.key"
        :index="item.key"
      >
        <span>{{ item.label }}</span>
      </el-menu-item>
    </el-menu>

    <!-- 右侧主显示区 -->
    <div class="settings-main">

    <!-- 个人资料 -->
    <div v-if="activeTab === 'profile'" class="settings-section profile-section">
      <!-- 子 Tab 切换 -->
      <el-tabs v-model="profileSubTab" class="profile-tabs">
        <el-tab-pane label="profileSubTab === 'basic' ? $t('settings.profileBasic') : ''" name="basic">
          <div class="setting-item">
            <label class="setting-label">{{ $t('settings.nickname') }}</label>
            <el-input v-model="profileForm.nickname" />
          </div>
          <div class="setting-item">
            <label class="setting-label">{{ $t('settings.language') }}</label>
            <el-select v-model="profileForm.language">
              <el-option label="中文" value="zh-CN" />
              <el-option label="English" value="en-US" />
            </el-select>
          </div>
          <el-button type="primary" @click="saveProfile">{{ $t('settings.save') }}</el-button>
        </el-tab-pane>
        
        <el-tab-pane :label="$t('settings.changePassword')" name="password">
          <div class="setting-item">
            <label class="setting-label">{{ $t('settings.oldPassword') }}</label>
            <el-input
              v-model="passwordForm.old_password"
              type="password"
              :placeholder="$t('settings.oldPasswordPlaceholder')"
              show-password
            />
          </div>
          <div class="setting-item">
            <label class="setting-label">{{ $t('settings.newPassword') }}</label>
            <el-input
              v-model="passwordForm.new_password"
              type="password"
              :placeholder="$t('settings.newPasswordPlaceholder')"
              show-password
            />
          </div>
          <div class="setting-item">
            <label class="setting-label">{{ $t('settings.confirmPassword') }}</label>
            <el-input
              v-model="passwordForm.confirm_password"
              type="password"
              :placeholder="$t('settings.confirmPasswordPlaceholder')"
              show-password
            />
          </div>
          <el-button
            type="primary"
            :disabled="!isPasswordFormValid || passwordLoading"
            @click="handleChangePassword"
          >
            {{ passwordLoading ? $t('common.saving') : $t('settings.changePasswordBtn') }}
          </el-button>
        </el-tab-pane>
      </el-tabs>
    </div>

    <!-- 邀请管理 -->
    <div v-if="activeTab === 'invitation'" class="settings-section invitation-section">
      <InvitationTab />
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
            <Pagination
              v-if="providerTotalPages > 1"
              :current-page="providerPage"
              :total-pages="providerTotalPages"
              :total="providerStore.providers.length"
              @change="(page) => providerPage = page"
            />
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
                  <span v-if="(model as any).model_type === 'embedding'" class="badge embedding">
                    {{ $t('settings.modelTypeEmbedding') }}
                  </span>
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
            <Pagination
              v-if="modelTotalPages > 1"
              :current-page="modelPage"
              :total-pages="modelTotalPages"
              :total="filteredModels.length"
              @change="(page) => modelPage = page"
            />
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
                  class="btn-skills"
                  @click="openSkillsDialog(expert)"
                  :title="$t('settings.manageSkills')"
                >
                  ⚡ {{ $t('settings.skills') }}
                </button>
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
        <Pagination
          v-if="expertTotalPages > 1"
          :current-page="expertPage"
          :total-pages="expertTotalPages"
          :total="expertStore.experts.length"
          @change="(page) => expertPage = page"
        />
      </div>
    </div>

    <!-- 助理设置 -->
    <div v-if="activeTab === 'assistant'" class="settings-section assistant-section">
      <AssistantSettingsTab />
    </div>

    <!-- 系统配置（仅管理员） -->
    <div v-if="activeTab === 'system' && isAdmin" class="settings-section system-section">
      <SystemConfigTab />
    </div>

    <!-- 用户管理 -->
    <div v-if="activeTab === 'user'" class="settings-section user-section">
      <div class="panel-header">
        <h3 class="panel-title">{{ $t('settings.userManagement') }}</h3>
        <button class="btn-icon-add" @click="openUserDialog()" :title="$t('settings.addUser')">
          <span class="icon">+</span>
        </button>
      </div>

      <!-- 搜索过滤 -->
      <div class="user-search">
        <input
          v-model="userSearchQuery"
          type="text"
          class="form-input"
          :placeholder="$t('settings.searchUsersPlaceholder')"
          @input="handleUserSearch"
        />
      </div>

      <div v-if="usersLoading" class="loading-state">
        {{ $t('common.loading') }}
      </div>

      <div v-else-if="usersList.length === 0" class="empty-state">
        {{ userSearchQuery ? $t('settings.noUsersFound') : $t('settings.noUsers') }}
      </div>

      <div v-else class="user-list-container">
        <div class="user-list">
          <div
            v-for="user in usersList"
            :key="user.id"
            class="user-item"
            :class="{ inactive: user.status !== 'active' }"
          >
            <div class="user-avatar">
              <span v-if="!user.avatar">👤</span>
              <img v-else :src="user.avatar" alt="avatar" />
            </div>
            <div class="user-info">
              <div class="user-header">
                <span class="user-name">{{ user.nickname || user.username }}</span>
                <span v-if="user.status !== 'active'" class="badge inactive">
                  {{ $t(`settings.userStatus.${user.status}`) }}
                </span>
                <span v-if="user.roles && user.roles.length > 0" class="user-roles">
                  {{ user.roles.join(', ') }}
                </span>
              </div>
              <div class="user-meta">
                <span class="user-email">{{ user.email }}</span>
                <span class="user-username">@{{ user.username }}</span>
                <span v-if="user.invitation_quota !== undefined" class="user-invitation-quota">
                  {{ $t('settings.invitationQuota') }}: {{ user.invitation_quota }}
                </span>
              </div>
            </div>
            <div class="user-actions">
              <button
                class="btn-edit"
                @click="openUserDialog(user)"
                :title="$t('common.edit')"
              >
                {{ $t('common.edit') }}
              </button>
              <button
                class="btn-delete-small"
                @click="confirmDeleteUser(user)"
                :title="$t('common.delete')"
              >
                {{ $t('common.delete') }}
              </button>
            </div>
          </div>
        </div>

        <!-- 用户分页 -->
        <Pagination
          v-if="userTotalPages > 1"
          :current-page="userPage"
          :total-pages="userTotalPages"
          :total="usersList.length"
          @change="(page) => userPage = page"
        />
      </div>
    </div>

    <!-- 角色管理 -->
    <div v-if="activeTab === 'role'" class="settings-section role-section">
      <div class="split-panel">
        <!-- 左侧：角色列表 -->
        <div class="panel role-list-panel">
          <div class="panel-header">
            <h3 class="panel-title">{{ $t('settings.roleManagement') }}</h3>
          </div>

          <div v-if="rolesLoading" class="loading-state">
            {{ $t('common.loading') }}
          </div>

          <div v-else-if="rolesList.length === 0" class="empty-state">
            {{ $t('settings.noRoles') }}
          </div>

          <div v-else class="role-list-container">
            <div class="role-list">
              <div
                v-for="role in rolesList"
                :key="role.id"
                class="role-item"
                :class="{ active: selectedRole?.id === role.id, system: role.is_system }"
              >
                <button
                  class="role-name-btn"
                  @click="selectRole(role)"
                >
                  <span class="role-name">{{ role.name }}</span>
                  <span v-if="role.is_system" class="badge system">
                    {{ $t('settings.builtinSkill') }}
                  </span>
                </button>
                <button
                  class="btn-edit"
                  @click.stop="openRoleDialog(role)"
                  :title="$t('common.edit')"
                >
                  {{ $t('common.edit') }}
                </button>
              </div>
            </div>
          </div>
        </div>

        <!-- 右侧：权限配置和专家访问权限 -->
        <div class="panel role-detail-panel">
          <div v-if="!selectedRole" class="empty-state select-role-hint">
            {{ $t('settings.selectRoleHint') }}
          </div>

          <template v-else>
            <el-tabs v-model="roleSubTab" class="role-tabs">
              <el-tab-pane :label="$t('settings.permissionConfig')" name="permissions">
                <div v-if="rolePermissionsLoading" class="loading-state">
                  {{ $t('common.loading') }}
                </div>

                <div v-else class="permissions-list">
                  <el-checkbox-group v-model="rolePermissionIds" @change="rolePermissionsChanged = true">
                    <el-checkbox
                      v-for="permission in allPermissions"
                      :key="permission.id"
                      :value="permission.id"
                      :label="permission.name"
                    >
                      <span class="permission-info">
                        <span class="permission-name">{{ permission.name }}</span>
                        <span v-if="permission.description" class="permission-desc">
                          {{ permission.description }}
                        </span>
                      </span>
                    </el-checkbox>
                  </el-checkbox-group>
                </div>

                <div v-if="!rolePermissionsLoading && allPermissions.length === 0" class="empty-state">
                  {{ $t('settings.noPermissionsAvailable') }}
                </div>

                <div class="role-tab-footer">
                  <span class="permissions-count">
                    {{ $t('settings.selectedPermissionsCount', { count: rolePermissionIds.length }) }}
                    <span v-if="isAdminRole" class="admin-hint">({{ $t('settings.adminRoleNoEdit') }})</span>
                  </span>
                  <el-button
                    type="primary"
                    :disabled="!rolePermissionsChanged || isAdminRole"
                    @click="saveRolePermissions"
                  >
                    {{ $t('common.save') }}
                  </el-button>
                </div>
              </el-tab-pane>

              <el-tab-pane :label="$t('settings.expertAccess')" name="experts">
                <div v-if="roleExpertsLoading" class="loading-state">
                  {{ $t('common.loading') }}
                </div>

                <div v-else class="experts-list">
                  <el-checkbox-group v-model="roleExpertIds" @change="roleExpertsChanged = true">
                    <el-checkbox
                      v-for="expert in allExperts"
                      :key="expert.id"
                      :value="expert.id"
                      :label="expert.name"
                    >
                      <span class="expert-info">
                        <span class="expert-name">{{ expert.name }}</span>
                        <span v-if="expert.introduction" class="expert-intro">
                          {{ expert.introduction }}
                        </span>
                      </span>
                    </el-checkbox>
                  </el-checkbox-group>
                </div>

                <div v-if="!roleExpertsLoading && allExperts.length === 0" class="empty-state">
                  {{ $t('settings.noExpertsAvailable') }}
                </div>

                <div class="role-tab-footer">
                  <span class="experts-count">
                    {{ $t('settings.selectedExpertsCount', { count: roleExpertIds.length }) }}
                    <span v-if="isAdminRole" class="admin-hint">({{ $t('settings.adminRoleNoEdit') }})</span>
                  </span>
                  <el-button
                    type="primary"
                    :disabled="!roleExpertsChanged || isAdminRole"
                    @click="saveRoleExperts"
                  >
                    {{ $t('common.save') }}
                  </el-button>
                </div>
              </el-tab-pane>
            </el-tabs>
          </template>
        </div>
      </div>
    </div>

    <!-- 组织架构管理 -->
    <div v-if="activeTab === 'organization'" class="settings-section organization-section">
      <OrganizationTab />
    </div>

    <!-- 驻留进程管理（仅管理员） -->
    <div v-if="activeTab === 'resident' && isAdmin" class="settings-section resident-section" style="padding: 0; overflow: hidden;">
      <ResidentProcessesTab />
    </div>

    <!-- 附件管理（仅管理员） -->
    <div v-if="activeTab === 'attachment' && isAdmin" class="settings-section attachment-section">
      <AttachmentTab />
    </div>

    <!-- MCP 管理（仅管理员） -->
    <div v-if="activeTab === 'mcp' && isAdmin" class="settings-section mcp-section">
      <McpTab />
    </div>

    <!-- App 管理（仅管理员） -->
    <div v-if="activeTab === 'apps' && isAdmin" class="settings-section apps-section">
      <AppManagementTab />
    </div>

    <!-- 处理脚本管理（仅管理员） -->
    <div v-if="activeTab === 'handlers' && isAdmin" class="settings-section handlers-section">
      <HandlerManagementTab />
    </div>

    <!-- 关于 -->
    <div v-if="activeTab === 'about'" class="settings-section">
      <div class="about-content">
        <h2 class="app-name">{{ $t('app.title') }}</h2>
        <p class="app-version">Version {{ appVersion }}</p>
        <p class="app-description">{{ $t('app.description') }}</p>
      </div>
    </div>

    <!-- Provider 添加/编辑对话框 -->
    <el-dialog
      v-model="showProviderDialog"
      :title="editingProvider ? $t('settings.editProvider') : $t('settings.addProvider')"
      width="500px"
    >
      <el-form label-width="100px">
        <el-form-item :label="$t('settings.providerName')" required>
          <el-input v-model="providerForm.name" :placeholder="$t('settings.providerNamePlaceholder')" />
        </el-form-item>
        <el-form-item :label="$t('settings.baseUrl')" required>
          <el-input v-model="providerForm.base_url" :placeholder="$t('settings.baseUrlPlaceholder')" />
        </el-form-item>
        <el-form-item :label="$t('settings.apiKey')">
          <el-input v-model="providerForm.api_key" type="password" :placeholder="$t('settings.apiKeyPlaceholder')" show-password />
          <div v-if="editingProvider" class="el-form-item__tip">{{ $t('settings.apiKeyHint') }}</div>
        </el-form-item>
        <el-form-item :label="$t('settings.timeout') + ' (秒)'">
          <el-input-number v-model="providerForm.timeout" :min="5" :max="300" />
        </el-form-item>
        <el-form-item :label="$t('settings.userAgent')">
          <el-input v-model="providerForm.user_agent" :placeholder="$t('settings.userAgentPlaceholder')" />
          <div class="el-form-item__tip">{{ $t('settings.userAgentHint') }}</div>
        </el-form-item>
        <el-form-item>
          <el-checkbox v-model="providerForm.is_active">{{ $t('settings.isActive') }}</el-checkbox>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button v-if="editingProvider" type="danger" @click="confirmDeleteProviderFromDialog">{{ $t('common.delete') }}</el-button>
        <el-button @click="closeProviderDialog">{{ $t('common.cancel') }}</el-button>
        <el-button type="primary" :disabled="!isProviderFormValid" @click="saveProvider">{{ $t('common.save') }}</el-button>
      </template>
    </el-dialog>

    <!-- Model 添加/编辑对话框 -->
    <el-dialog
      v-model="showModelDialog"
      :title="editingModel ? $t('settings.editModel') : $t('settings.addModel')"
      width="600px"
    >
      <el-form label-width="120px">
        <el-form-item :label="$t('settings.modelName')" required>
          <el-input v-model="modelForm.name" :placeholder="$t('settings.modelNamePlaceholder')" />
        </el-form-item>
        <el-form-item :label="$t('settings.modelIdentifier')" required>
          <el-input v-model="modelForm.model_name" :placeholder="$t('settings.modelIdentifierPlaceholder')" />
          <div class="el-form-item__tip">{{ $t('settings.modelIdentifierHint') }}</div>
        </el-form-item>
        <el-form-item :label="$t('settings.provider')" required>
          <el-select v-model="modelForm.provider_id" clearable>
            <el-option label="" value="" />
            <el-option v-for="provider in providerStore.providers" :key="provider.id" :value="provider.id" :label="provider.name" />
          </el-select>
        </el-form-item>
        <el-form-item :label="$t('settings.modelType')">
          <el-select v-model="modelForm.model_type">
            <el-option value="text" :label="$t('settings.modelTypeText')" />
            <el-option value="multimodal" :label="$t('settings.modelTypeMultimodal')" />
            <el-option value="embedding" :label="$t('settings.modelTypeEmbedding')" />
          </el-select>
        </el-form-item>

        <el-form-item v-if="modelForm.model_type === 'text' || modelForm.model_type === 'multimodal'" :label="$t('settings.maxTokens')">
          <el-input-number v-model="modelForm.max_tokens" :placeholder="$t('settings.maxTokensPlaceholder')" />
          <div class="el-form-item__tip">{{ $t('settings.maxTokensHint') }}</div>
        </el-form-item>

        <el-form-item v-if="modelForm.model_type === 'text' || modelForm.model_type === 'multimodal'" :label="$t('settings.maxOutputTokens')">
          <el-input-number v-model="modelForm.max_output_tokens" :placeholder="$t('settings.maxOutputTokensPlaceholder')" />
          <div class="el-form-item__tip">{{ $t('settings.maxOutputTokensHint') }}</div>
        </el-form-item>

        <el-form-item v-if="modelForm.model_type === 'embedding'" :label="$t('settings.embeddingDim')">
          <el-input-number v-model="modelForm.embedding_dim" :placeholder="$t('settings.embeddingDimPlaceholder')" />
        </el-form-item>

        <el-form-item :label="$t('settings.costPer1kInput') + ' (USD)'">
          <el-input-number v-model="modelForm.cost_per_1k_input" :precision="4" :step="0.0001" :placeholder="$t('settings.costPlaceholder')" />
        </el-form-item>

        <el-form-item :label="$t('settings.costPer1kOutput') + ' (USD)'">
          <el-input-number v-model="modelForm.cost_per_1k_output" :precision="4" :step="0.0001" :placeholder="$t('settings.costPlaceholder')" />
        </el-form-item>

        <el-form-item :label="$t('settings.modelDescription')">
          <el-input v-model="modelForm.description" type="textarea" :rows="3" :placeholder="$t('settings.descriptionPlaceholder')" />
        </el-form-item>

        <el-divider v-if="modelForm.model_type === 'text' || modelForm.model_type === 'multimodal'">{{ $t('settings.thinkingConfig') }}</el-divider>

        <el-form-item v-if="modelForm.model_type === 'text' || modelForm.model_type === 'multimodal'">
          <el-checkbox v-model="modelForm.supports_reasoning">{{ $t('settings.supportsReasoning') }}</el-checkbox>
          <div class="el-form-item__tip">{{ $t('settings.supportsReasoningHint') }}</div>
        </el-form-item>

        <el-form-item v-if="(modelForm.model_type === 'text' || modelForm.model_type === 'multimodal') && modelForm.supports_reasoning" :label="$t('settings.thinkingFormat')">
          <el-select v-model="modelForm.thinking_format">
            <el-option value="none" :label="$t('settings.thinkingFormatNone')" />
            <el-option value="openai" :label="$t('settings.thinkingFormatOpenai')" />
            <el-option value="deepseek" :label="$t('settings.thinkingFormatDeepseek')" />
            <el-option value="qwen" :label="$t('settings.thinkingFormatQwen')" />
          </el-select>
          <div class="el-form-item__tip">{{ $t('settings.thinkingFormatHint') }}</div>
        </el-form-item>

        <el-form-item>
          <el-checkbox v-model="modelForm.is_active">{{ $t('settings.isActive') }}</el-checkbox>
        </el-form-item>
      </el-form>

      <template #footer>
        <el-button v-if="editingModel" type="danger" @click="confirmDeleteModelFromDialog">{{ $t('common.delete') }}</el-button>
        <el-button @click="closeModelDialog">{{ $t('common.cancel') }}</el-button>
        <el-button type="primary" :disabled="!isModelFormValid" @click="saveModel">{{ $t('common.save') }}</el-button>
      </template>
    </el-dialog>

    <!-- Expert 添加/编辑对话框 -->
    <!-- Expert 添加/编辑对话框 -->
    <el-dialog
      v-model="showExpertDialog"
      :title="editingExpert ? $t('settings.editExpert') : $t('settings.addExpert')"
      width="800px"
      class="expert-dialog"
    >
      <el-tabs v-model="expertActiveTab">
        <el-tab-pane :label="$t('settings.expertBasicInfo')" name="basic">
          <el-row :gutter="20">
            <el-col :span="18">
              <el-form-item :label="$t('settings.expertName')" required>
                <el-input v-model="expertForm.name" :placeholder="$t('settings.expertNamePlaceholder')" />
              </el-form-item>
            </el-col>
            <el-col :span="6">
              <el-checkbox v-model="expertForm.is_active">{{ $t('settings.isActive') }}</el-checkbox>
            </el-col>
          </el-row>

          <el-row :gutter="20">
            <el-col :span="12">
              <el-form-item :label="$t('settings.expertAvatar')">
                <div class="avatar-upload">
                  <div class="avatar-preview" :style="expertForm.avatar_base64 ? { backgroundImage: `url(${expertForm.avatar_base64})` } : {}">
                    <span v-if="!expertForm.avatar_base64">🤖</span>
                  </div>
                  <div class="avatar-actions">
                    <input type="file" accept="image/*" ref="smallAvatarInput" @change="handleSmallAvatarUpload" style="display: none" />
                    <el-button size="small" @click="smallAvatarInput?.click()">{{ $t('settings.uploadAvatar') }}</el-button>
                    <el-button v-if="expertForm.avatar_base64" size="small" type="danger" @click="expertForm.avatar_base64 = ''">{{ $t('common.delete') }}</el-button>
                  </div>
                </div>
              </el-form-item>
            </el-col>
            <el-col :span="12">
              <el-form-item :label="$t('settings.expertAvatarLarge')">
                <div class="avatar-upload">
                  <div class="avatar-preview large" :style="expertForm.avatar_large_base64 ? { backgroundImage: `url(${expertForm.avatar_large_base64})` } : {}">
                    <span v-if="!expertForm.avatar_large_base64">🖼️</span>
                  </div>
                  <div class="avatar-actions">
                    <input type="file" accept="image/*" ref="largeAvatarInput" @change="handleLargeAvatarUpload" style="display: none" />
                    <el-button size="small" @click="largeAvatarInput?.click()">{{ $t('settings.uploadAvatar') }}</el-button>
                    <el-button v-if="expertForm.avatar_large_base64" size="small" type="danger" @click="expertForm.avatar_large_base64 = ''">{{ $t('common.delete') }}</el-button>
                  </div>
                </div>
              </el-form-item>
            </el-col>
          </el-row>

          <el-form-item :label="$t('settings.expertIntroduction')">
            <el-input v-model="expertForm.introduction" type="textarea" :rows="3" :placeholder="$t('settings.expertIntroductionPlaceholder')" />
          </el-form-item>
        </el-tab-pane>

        <el-tab-pane :label="$t('settings.expertPersonality')" name="personality">
          <el-form-item :label="$t('settings.expertCoreValues')">
            <el-input v-model="expertForm.core_values" type="textarea" :rows="3" :placeholder="$t('settings.expertCoreValuesPlaceholder')" />
          </el-form-item>

          <el-form-item :label="$t('settings.expertBehavioralGuidelines')">
            <el-input v-model="expertForm.behavioral_guidelines" type="textarea" :rows="4" :placeholder="$t('settings.expertBehavioralGuidelinesPlaceholder')" />
          </el-form-item>

          <el-form-item :label="$t('settings.expertTaboos')">
            <el-input v-model="expertForm.taboos" type="textarea" :rows="3" :placeholder="$t('settings.expertTaboosPlaceholder')" />
          </el-form-item>

          <el-row :gutter="20">
            <el-col :span="12">
              <el-form-item :label="$t('settings.expertSpeakingStyle')">
                <el-input v-model="expertForm.speaking_style" :placeholder="$t('settings.expertSpeakingStylePlaceholder')" />
              </el-form-item>
            </el-col>
            <el-col :span="12">
              <el-form-item :label="$t('settings.expertEmotionalTone')">
                <el-input v-model="expertForm.emotional_tone" :placeholder="$t('settings.expertEmotionalTonePlaceholder')" />
              </el-form-item>
            </el-col>
          </el-row>
        </el-tab-pane>

        <el-tab-pane :label="$t('settings.expertModelConfig')" name="model">
          <el-row :gutter="20">
            <el-col :span="12">
              <el-form-item :label="$t('settings.expertExpressiveModel')">
                <el-select v-model="expertForm.expressive_model_id" clearable>
                  <el-option label="" value="" />
                  <el-option v-for="model in expertAvailableModels" :key="model.id" :value="model.id" :label="model.name" />
                </el-select>
              </el-form-item>
            </el-col>
            <el-col :span="12">
              <el-form-item :label="$t('settings.expertReflectiveModel')">
                <el-select v-model="expertForm.reflective_model_id" clearable>
                  <el-option label="" value="" />
                  <el-option v-for="model in expertAvailableModels" :key="model.id" :value="model.id" :label="model.name" />
                </el-select>
              </el-form-item>
            </el-col>
          </el-row>

          <el-form-item :label="$t('settings.expertPromptTemplate')">
            <el-input v-model="expertForm.prompt_template" type="textarea" :rows="5" :placeholder="$t('settings.expertPromptTemplatePlaceholder')" />
          </el-form-item>

          <el-divider>{{ $t('settings.contextCompression') }}</el-divider>

          <el-form-item :label="$t('settings.contextStrategy')">
            <el-select v-model="expertForm.context_strategy">
              <el-option value="full" :label="$t('settings.contextStrategyFull')" />
              <el-option value="simple" :label="$t('settings.contextStrategySimple')" />
              <el-option value="minimal" :label="$t('settings.contextStrategyMinimal')" />
            </el-select>
            <div class="el-form-item__tip">{{ $t('settings.contextStrategyHint') }}</div>
          </el-form-item>

          <el-form-item :label="$t('settings.contextThreshold')">
            <el-input-number v-model="expertForm.context_threshold" :precision="2" :step="0.05" :min="0.3" :max="0.95" />
            <div class="el-form-item__tip">{{ $t('settings.contextThresholdHint') }}</div>
          </el-form-item>

          <el-divider>{{ $t('settings.llmParams') }}</el-divider>

          <el-row :gutter="20">
            <el-col :span="12">
              <el-form-item :label="$t('settings.temperature')">
                <el-input-number v-model="expertForm.temperature" :precision="1" :step="0.1" :min="0" :max="2" />
                <div class="el-form-item__tip">{{ $t('settings.temperatureHint') }}</div>
              </el-form-item>
            </el-col>
            <el-col :span="12">
              <el-form-item :label="$t('settings.reflectiveTemperature')">
                <el-input-number v-model="expertForm.reflective_temperature" :precision="1" :step="0.1" :min="0" :max="2" />
                <div class="el-form-item__tip">{{ $t('settings.reflectiveTemperatureHint') }}</div>
              </el-form-item>
            </el-col>
          </el-row>

          <el-row :gutter="20">
            <el-col :span="12">
              <el-form-item :label="$t('settings.topP')">
                <el-input-number v-model="expertForm.top_p" :precision="1" :step="0.1" :min="0" :max="1" />
                <div class="el-form-item__tip">{{ $t('settings.topPHint') }}</div>
              </el-form-item>
            </el-col>
            <el-col :span="12">
              <el-form-item :label="$t('settings.frequencyPenalty')">
                <el-input-number v-model="expertForm.frequency_penalty" :precision="1" :step="0.1" :min="-2" :max="2" />
                <div class="el-form-item__tip">{{ $t('settings.frequencyPenaltyHint') }}</div>
              </el-form-item>
            </el-col>
          </el-row>

          <el-row :gutter="20">
            <el-col :span="12">
              <el-form-item :label="$t('settings.presencePenalty')">
                <el-input-number v-model="expertForm.presence_penalty" :precision="1" :step="0.1" :min="-2" :max="2" />
                <div class="el-form-item__tip">{{ $t('settings.presencePenaltyHint') }}</div>
              </el-form-item>
            </el-col>
          </el-row>

          <el-divider>{{ $t('settings.toolCallConfig') }}</el-divider>

          <el-form-item :label="$t('settings.maxToolRounds')">
            <el-input-number v-model="expertForm.max_tool_rounds" :min="1" :max="50" :placeholder="$t('settings.maxToolRoundsPlaceholder')" />
            <div class="el-form-item__tip">{{ $t('settings.maxToolRoundsExpertHint') }}</div>
          </el-form-item>
        </el-tab-pane>
      </el-tabs>

      <template #footer>
        <el-button v-if="editingExpert" type="danger" @click="confirmDeleteExpertFromDialog">{{ $t('common.delete') }}</el-button>
        <el-button @click="closeExpertDialog">{{ $t('common.cancel') }}</el-button>
        <el-button type="primary" :disabled="!isExpertFormValid" @click="saveExpert">{{ $t('common.save') }}</el-button>
      </template>
    </el-dialog>

<!-- 技能管理对话框 -->
    <el-dialog
      v-model="showSkillsDialog"
      :title="$t('settings.manageSkillsFor', { name: currentExpertForSkills?.name })"
      width="600px"
    >
      <el-input
        v-model="skillsSearchQuery"
        :placeholder="$t('settings.searchSkillsPlaceholder')"
        clearable
      />

      <div v-if="skillsLoading" class="loading-state">
        {{ $t('common.loading') }}
      </div>

      <el-empty
        v-else-if="filteredSkills.length === 0"
        :description="skillsSearchQuery ? $t('settings.noSkillsFound') : $t('settings.noSkillsAvailable')"
      />

      <div v-else class="skills-list">
        <div
          v-for="skill in filteredSkills"
          :key="skill.id"
          class="skill-item"
          :class="{ builtin: skill.is_builtin }"
        >
          <div class="skill-info">
            <div class="skill-header">
              <span class="skill-name">{{ skill.name }}</span>
              <el-tag v-if="skill.is_builtin" type="info" size="small">
                {{ $t('settings.builtinSkill') }}
              </el-tag>
            </div>
            <p v-if="skill.description" class="skill-description">
              {{ skill.description }}
            </p>
          </div>
          <el-switch
            v-model="skill.is_enabled"
            @change="handleSkillToggle(skill)"
          />
        </div>
      </div>

      <template #footer>
        <span class="skills-count">
          {{ $t('settings.enabledSkillsCount', { count: enabledSkillsCount }) }}
        </span>
        <el-button @click="closeSkillsDialog">{{ $t('common.cancel') }}</el-button>
        <el-button type="primary" @click="saveSkills">{{ $t('common.save') }}</el-button>
</template>
    </el-dialog>

    <!-- 用户添加/编辑对话框 -->
    <el-dialog
      v-model="showUserDialog"
      :title="editingUser ? $t('settings.editUser') : $t('settings.addUser')"
      width="700px"
    >
      <el-form label-width="100px">
        <el-row :gutter="20">
          <el-col :span="12">
            <el-form-item :label="$t('settings.username')" required>
              <el-input
                v-model="userForm.username"
                :placeholder="$t('settings.usernamePlaceholder')"
                :disabled="!!editingUser"
                @input="handleUsernameInput"
              />
              <div v-if="!editingUser" class="el-form-item__tip">{{ $t('settings.usernameFormatHint') }}</div>
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item :label="$t('settings.email')" required>
              <el-input
                v-model="userForm.email"
                type="email"
                :placeholder="$t('settings.emailPlaceholder')"
              />
            </el-form-item>
          </el-col>
        </el-row>

        <el-form-item v-if="!editingUser" :label="$t('settings.password')" required>
          <el-input
            v-model="userForm.password"
            type="password"
            :placeholder="$t('settings.passwordPlaceholder')"
            show-password
          />
        </el-form-item>

        <el-row :gutter="20">
          <el-col :span="12">
            <el-form-item :label="$t('settings.userNickname')">
              <el-input
                v-model="userForm.nickname"
                :placeholder="$t('settings.userNicknamePlaceholder')"
              />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item :label="$t('settings.userStatusText')">
              <el-select v-model="userForm.status">
                <el-option label="active" value="active">{{ $t('settings.userStatus.active') }}</el-option>
                <el-option label="inactive" value="inactive">{{ $t('settings.userStatus.inactive') }}</el-option>
                <el-option label="banned" value="banned">{{ $t('settings.userStatus.banned') }}</el-option>
              </el-select>
            </el-form-item>
          </el-col>
        </el-row>

        <el-form-item :label="$t('settings.userRoles')">
          <div v-if="rolesLoading">{{ $t('common.loading') }}</div>
          <el-checkbox-group v-else v-model="userForm.selectedRoleIds">
            <el-checkbox v-for="role in rolesList" :key="role.id" :value="role.id">
              {{ role.name }}
              <el-tag v-if="role.is_system" type="info" size="small">{{ $t('settings.builtinSkill') }}</el-tag>
            </el-checkbox>
          </el-checkbox-group>
          <div v-if="rolesList.length === 0 && !rolesLoading" class="el-form-item__tip">{{ $t('settings.noRolesAvailable') }}</div>
        </el-form-item>

        <el-form-item v-if="editingUser" :label="$t('settings.invitationQuota')">
          <el-input-number v-model="userForm.invitation_quota" :min="0" :max="100" />
          <div class="el-form-item__tip">{{ $t('settings.invitationQuotaHint') }}</div>
        </el-form-item>

        <el-row :gutter="20">
          <el-col :span="12">
            <el-form-item :label="$t('settings.gender')">
              <el-select v-model="userForm.gender" clearable>
                <el-option label="" value="" />
                <el-option label="male" value="male">{{ $t('settings.genderMale') }}</el-option>
                <el-option label="female" value="female">{{ $t('settings.genderFemale') }}</el-option>
                <el-option label="other" value="other">{{ $t('settings.genderOther') }}</el-option>
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item :label="$t('settings.birthday')">
              <el-date-picker v-model="userForm.birthday" type="date" />
            </el-form-item>
          </el-col>
        </el-row>

        <el-row :gutter="20">
          <el-col :span="12">
            <el-form-item :label="$t('settings.occupation')">
              <el-input v-model="userForm.occupation" :placeholder="$t('settings.occupationPlaceholder')" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item :label="$t('settings.location')">
              <el-input v-model="userForm.location" :placeholder="$t('settings.locationPlaceholder')" />
            </el-form-item>
          </el-col>
        </el-row>

        <el-form-item :label="$t('settings.userAvatar')">
          <div class="avatar-upload">
            <div class="avatar-preview" :style="userForm.avatar ? { backgroundImage: `url(${userForm.avatar})` } : {}">
              <span v-if="!userForm.avatar">👤</span>
            </div>
            <div class="avatar-actions">
              <input type="file" accept="image/*" ref="userAvatarInput" @change="handleUserAvatarUpload" style="display: none" />
              <el-button size="small" @click="userAvatarInput?.click()">{{ $t('settings.uploadAvatar') }}</el-button>
              <el-button v-if="userForm.avatar" size="small" type="danger" @click="userForm.avatar = ''">{{ $t('common.delete') }}</el-button>
            </div>
          </div>
        </el-form-item>

        <el-divider v-if="editingUser">{{ $t('settings.resetPassword') }}</el-divider>

        <el-form-item v-if="editingUser" :label="$t('settings.newPassword')">
          <el-input v-model="userForm.newPassword" type="password" :placeholder="$t('settings.newPasswordPlaceholder')" show-password>
            <template #append>
              <el-button :disabled="!userForm.newPassword || userForm.newPassword.length < 6" @click="handleResetPassword">{{ $t('settings.resetPasswordBtn') }}</el-button>
            </template>
          </el-input>
        </el-form-item>
      </el-form>

      <template #footer>
        <el-button v-if="editingUser" type="danger" @click="confirmDeleteUserFromDialog">{{ $t('common.delete') }}</el-button>
        <el-button @click="closeUserDialog">{{ $t('common.cancel') }}</el-button>
        <el-button type="primary" :disabled="!isUserFormValid" @click="saveUser">{{ $t('common.save') }}</el-button>
      </template>
    </el-dialog>
    <!-- 角色编辑对话框 -->
    <el-dialog
      v-model="showRoleDialog"
      :title="$t('settings.editRole')"
      width="500px"
    >
      <el-form label-width="100px">
        <el-form-item :label="$t('settings.roleMark')">
          <el-input
            v-model="roleForm.mark"
            disabled
            :placeholder="$t('settings.roleMarkPlaceholder')"
          />
          <div class="el-form-item__tip">{{ $t('settings.roleMarkHint') }}</div>
        </el-form-item>
        <el-form-item :label="$t('settings.roleName')">
          <el-input
            v-model="roleForm.name"
            :placeholder="$t('settings.roleNamePlaceholder')"
          />
        </el-form-item>
        <el-form-item :label="$t('settings.roleDescription')">
          <el-input
            v-model="roleForm.description"
            type="textarea"
            :rows="3"
            :placeholder="$t('settings.roleDescriptionPlaceholder')"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="closeRoleDialog">{{ $t('common.cancel') }}</el-button>
        <el-button type="primary" :disabled="!isRoleFormValid" @click="saveRole">{{ $t('common.save') }}</el-button>
      </template>
    </el-dialog>
  </div>
</div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted, computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute } from 'vue-router'
import { ElMessageBox } from 'element-plus'
import { useUserStore } from '@/stores/user'
import { useModelStore } from '@/stores/model'
import { useProviderStore } from '@/stores/provider'
import { useExpertStore } from '@/stores/expert'
import { useToastStore } from '@/stores/toast'
import { compressSmallAvatar, compressLargeAvatar } from '@/utils/imageCompress'
import { expertApi, userApi, roleApi } from '@/api/services'
import type { AIModel, ModelProvider, ProviderFormData, ModelFormData, Expert, ExpertSkill, ExpertSkillConfig, UserListItem, CreateUserRequest, UpdateUserRequest, Role, Permission, ExpertSimple, UpdateRoleRequest } from '@/types'
import OrganizationTab from '@/components/settings/OrganizationTab.vue'
import SystemConfigTab from '@/components/settings/SystemConfigTab.vue'
import AssistantSettingsTab from '@/components/settings/AssistantSettingsTab.vue'
import InvitationTab from '@/components/settings/InvitationTab.vue'
import ResidentProcessesTab from '@/components/settings/ResidentProcessesTab.vue'
import AttachmentTab from '@/components/settings/AttachmentTab.vue'
import McpTab from '@/components/settings/McpTab.vue'
import AppManagementTab from '@/components/settings/AppManagementTab.vue'
import HandlerManagementTab from '@/components/settings/HandlerManagementTab.vue'
import Pagination from '@/components/Pagination.vue'
import packageInfo from '../../package.json'

const { t, locale } = useI18n()
const route = useRoute()
const userStore = useUserStore()
const modelStore = useModelStore()
const providerStore = useProviderStore()
const expertStore = useExpertStore()
const toast = useToastStore()

// 应用版本号
const appVersion = computed(() => packageInfo.version)

// 根据路由确定当前分组
const currentGroup = computed(() => {
  const group = route.meta?.settingsGroup as string | undefined
  return group || 'personal'
})

// 菜单项配置（按分组）
const menuItemsByGroup: Record<string, { key: string; label: string }[]> = {
  organization: [
    { key: 'user', label: t('settings.userManagement') },
    { key: 'role', label: t('settings.roleManagement') },
    { key: 'organization', label: t('settings.organizationManagement') },
  ],
  personal: [
    { key: 'profile', label: t('settings.profile') },
    { key: 'invitation', label: t('settings.invitation') },
    { key: 'about', label: t('settings.about') },
  ],
  system: [
    { key: 'model', label: t('settings.modelAndProvider') },
    { key: 'expert', label: t('settings.expertSettings') },
    { key: 'assistant', label: t('settings.assistantSettings') },
    { key: 'resident', label: t('settings.residentProcesses') },
    { key: 'attachment', label: t('settings.attachmentManagement') },
    { key: 'mcp', label: t('settings.mcp.management') },
    { key: 'apps', label: t('settings.appManagement.management') },
    { key: 'handlers', label: t('settings.handlerManagement.management') },
    { key: 'system', label: t('settings.systemConfig') },
  ],
}

// 当前分组的菜单项
const currentMenuItems = computed(() => {
  return menuItemsByGroup[currentGroup.value] || menuItemsByGroup.personal
})

// 根据路由初始化 activeTab
const getInitialTab = () => {
  const group = currentGroup.value
  const items = menuItemsByGroup[group]
  if (items && items.length > 0) {
    return items[0]?.key ?? 'profile'
  }
  return 'profile'
}

const activeTab = ref(getInitialTab())
const profileSubTab = ref<'basic' | 'password'>('basic')
const sidebarCollapsed = ref(false)

const handleMenuSelect = (index: string) => {
  activeTab.value = index
}

const profileForm = reactive({
  nickname: '',
  language: 'zh-CN',
})

// 修改密码表单
const passwordForm = reactive({
  old_password: '',
  new_password: '',
  confirm_password: '',
})
const passwordLoading = ref(false)

// 密码表单验证
const isPasswordFormValid = computed(() => {
  return (
    passwordForm.old_password.length >= 6 &&
    passwordForm.new_password.length >= 6 &&
    passwordForm.new_password === passwordForm.confirm_password
  )
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

// 专家可用的模型（只显示文本模型和多模态模型）
const expertAvailableModels = computed(() => {
  return modelStore.models.filter(m =>
    m.is_active &&
    (m.model_type === 'text' || m.model_type === 'multimodal')
  )
})

// 是否为管理员
const isAdmin = computed(() => userStore.isAdmin)

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
  user_agent: '',
  is_active: true,
})

const isProviderFormValid = computed(() => {
  return providerForm.name.trim() && providerForm.base_url.trim()
})

// Model 对话框
const showModelDialog = ref(false)
const editingModel = ref<AIModel | null>(null)
const modelForm = reactive<ModelFormData>({
  name: '',
  model_name: '',
  provider_id: '',
  model_type: 'text',
  max_tokens: undefined,
  max_output_tokens: undefined,
  embedding_dim: undefined,
  cost_per_1k_input: undefined,
  cost_per_1k_output: undefined,
  description: '',
  is_active: true,
  supports_reasoning: false,
  thinking_format: 'none',
})

const isModelFormValid = computed(() => {
  return modelForm.name?.trim() && modelForm.model_name?.trim() && modelForm.provider_id?.trim()
})

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
  context_strategy: 'full' as 'full' | 'simple' | 'minimal',
  context_threshold: 0.70,
  // LLM 参数配置
  temperature: 0.70,
  reflective_temperature: 0.30,
  top_p: 1.0,
  frequency_penalty: 0.0,
  presence_penalty: 0.0,
  // 工具调用配置
  max_tool_rounds: null as number | null,
  // 头像
  avatar_base64: '',
  avatar_large_base64: '',
  is_active: true,
})

const isExpertFormValid = computed(() => {
  return expertForm.name?.trim()
})

// Expert 对话框 Tab 状态
const expertActiveTab = ref<'basic' | 'personality' | 'model'>('basic')

const expertTabs = computed(() => [
  { key: 'basic' as const, label: t('settings.expertTabBasic') },
  { key: 'personality' as const, label: t('settings.expertTabPersonality') },
  { key: 'model' as const, label: t('settings.expertTabModel') },
])

// 技能管理对话框
const showSkillsDialog = ref(false)
const currentExpertForSkills = ref<Expert | null>(null)
const skillsList = ref<ExpertSkill[]>([])
const skillsLoading = ref(false)
const skillsSearchQuery = ref('')
const skillsChanged = ref(false)

// 头像上传 ref
const smallAvatarInput = ref<HTMLInputElement | null>(null)
const largeAvatarInput = ref<HTMLInputElement | null>(null)

// 用户管理状态
const usersList = ref<UserListItem[]>([])
const usersLoading = ref(false)
const userSearchQuery = ref('')
const userPage = ref(1)
const userTotalPages = ref(1)
const USER_PAGE_SIZE = 10

// 用户对话框
const showUserDialog = ref(false)
const editingUser = ref<UserListItem | null>(null)
const userForm = reactive({
  username: '',
  email: '',
  password: '',
  nickname: '',
  gender: '',
  birthday: '',
  occupation: '',
  location: '',
  status: 'active' as 'active' | 'inactive' | 'banned',
  avatar: '',
  newPassword: '',
  selectedRoleIds: [] as string[],
  invitation_quota: 1,
})

// 角色列表
const rolesList = ref<import('@/types').Role[]>([])
const rolesLoading = ref(false)

// 用户头像上传 ref
const userAvatarInput = ref<HTMLInputElement | null>(null)

// 角色管理状态
const selectedRole = ref<Role | null>(null)
const roleSubTab = ref<'permissions' | 'experts'>('permissions')
const allPermissions = ref<Permission[]>([])
const allExperts = ref<ExpertSimple[]>([])
const rolePermissionIds = ref<string[]>([])
const roleExpertIds = ref<string[]>([])
const rolePermissionsLoading = ref(false)
const roleExpertsLoading = ref(false)
const rolePermissionsChanged = ref(false)
const roleExpertsChanged = ref(false)
const isAdminRole = ref(false)  // 当前选中角色是否为管理员角色

// 角色编辑对话框
const showRoleDialog = ref(false)
const editingRole = ref<Role | null>(null)
const roleForm = reactive({
  mark: '',   // 角色标识符（不可变）
  name: '',   // 显示名称（可编辑）
  description: '',
})

// 角色表单验证
const isRoleFormValid = computed(() => {
  return roleForm.name?.trim()
})

// 用户表单验证
const isUserFormValid = computed(() => {
  if (!userForm.username.trim() || !userForm.email.trim()) {
    return false
  }
  // 新增用户时需要密码
  if (!editingUser.value && (!userForm.password || userForm.password.length < 6)) {
    return false
  }
  // 验证邮箱格式
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  if (!emailRegex.test(userForm.email)) {
    return false
  }
  return true
})

// 加载用户列表
const loadUsers = async () => {
  usersLoading.value = true
  try {
    const response = await userApi.getUsers({
      page: userPage.value,
      size: USER_PAGE_SIZE,
      search: userSearchQuery.value || undefined,
    })
    usersList.value = response.items
    userTotalPages.value = response.pages
  } catch (err) {
    console.error('加载用户列表失败:', err)
    toast.error(t('settings.loadUsersFailed'))
  } finally {
    usersLoading.value = false
  }
}

// 用户搜索防抖
let userSearchTimeout: ReturnType<typeof setTimeout> | null = null
const handleUserSearch = () => {
  if (userSearchTimeout) {
    clearTimeout(userSearchTimeout)
  }
  userSearchTimeout = setTimeout(() => {
    userPage.value = 1
    loadUsers()
  }, 300)
}

// 加载角色列表
const loadRoles = async () => {
  rolesLoading.value = true
  try {
    const roles = await userApi.getRoles()
    rolesList.value = roles
  } catch (err) {
    console.error('加载角色列表失败:', err)
  } finally {
    rolesLoading.value = false
  }
}

// 打开用户对话框
const openUserDialog = async (user?: UserListItem) => {
  // 加载角色列表
  await loadRoles()
  
  if (user) {
    editingUser.value = user
    userForm.username = user.username
    userForm.email = user.email
    userForm.password = ''
    userForm.nickname = user.nickname || ''
    userForm.gender = user.gender || ''
    userForm.birthday = user.birthday || ''
    userForm.occupation = user.occupation || ''
    userForm.location = user.location || ''
    userForm.status = user.status
    userForm.avatar = user.avatar || ''
    userForm.newPassword = ''
    userForm.invitation_quota = (user as any).invitation_quota ?? 1
    // 设置用户当前角色：根据角色标识符(mark)找到对应的角色ID
    if (user.roles && user.roles.length > 0) {
      const roleIds = rolesList.value
        .filter(r => user.roles!.includes(r.mark))
        .map(r => r.id)
      userForm.selectedRoleIds = roleIds
    } else {
      userForm.selectedRoleIds = []
    }
  } else {
    editingUser.value = null
    userForm.username = ''
    userForm.email = ''
    userForm.password = ''
    userForm.nickname = ''
    userForm.gender = ''
    userForm.birthday = ''
    userForm.occupation = ''
    userForm.location = ''
    userForm.status = 'active'
    userForm.avatar = ''
    userForm.newPassword = ''
    userForm.selectedRoleIds = []
    userForm.invitation_quota = 1
  }
  showUserDialog.value = true
}

// 关闭用户对话框
const closeUserDialog = () => {
  showUserDialog.value = false
  editingUser.value = null
}

// 保存用户
const saveUser = async () => {
  try {
    if (editingUser.value) {
      // 更新用户
      const updateData: UpdateUserRequest = {
        email: userForm.email,
        nickname: userForm.nickname,
        gender: userForm.gender as import('@/types').UserGender || undefined,
        birthday: userForm.birthday || undefined,
        occupation: userForm.occupation || undefined,
        location: userForm.location || undefined,
        status: userForm.status,
        avatar: userForm.avatar || undefined,
      }
      await userApi.updateUser(editingUser.value.id, updateData)
      // 更新用户角色
      await userApi.updateUserRoles(editingUser.value.id, { roleIds: userForm.selectedRoleIds })
      // 更新用户邀请配额
      await userApi.updateInvitationQuota(editingUser.value.id, userForm.invitation_quota)
    } else {
      // 创建用户
      const createData: CreateUserRequest = {
        username: userForm.username,
        email: userForm.email,
        password: userForm.password,
        nickname: userForm.nickname || undefined,
        gender: userForm.gender as import('@/types').UserGender || undefined,
        birthday: userForm.birthday || undefined,
        occupation: userForm.occupation || undefined,
        location: userForm.location || undefined,
        status: userForm.status,
        avatar: userForm.avatar || undefined,
      }
      const newUser = await userApi.createUser(createData)
      // 为新用户设置角色
      if (newUser && newUser.id && userForm.selectedRoleIds.length > 0) {
        await userApi.updateUserRoles(newUser.id, { roleIds: userForm.selectedRoleIds })
      }
      // 为新用户设置邀请配额
      if (newUser && newUser.id) {
        await userApi.updateInvitationQuota(newUser.id, userForm.invitation_quota)
      }
    }
    closeUserDialog()
    loadUsers()
    toast.success(t('settings.saveUserSuccess'))
  } catch (err) {
    console.error('保存用户失败:', err)
    toast.error(t('settings.saveUserFailed'))
  }
}

// 确认删除用户
const confirmDeleteUser = async (user: UserListItem) => {
  try {
    await ElMessageBox.confirm(
      t('settings.deleteUserConfirm', { name: user.nickname || user.username }),
      t('common.confirmDelete'),
      {
        confirmButtonText: t('common.delete'),
        cancelButtonText: t('common.cancel'),
        type: 'warning'
      }
    )
    
    await userApi.deleteUser(user.id)
    loadUsers()
  } catch (err) {
    if (err !== 'cancel') {
      console.error('删除用户失败:', err)
      toast.error(t('settings.deleteUserFailed'))
    }
  }
}

// 从对话框内确认删除
const confirmDeleteUserFromDialog = async () => {
  if (!editingUser.value) return
  
  try {
    await ElMessageBox.confirm(
      t('settings.deleteUserConfirm', { name: editingUser.value.nickname || editingUser.value.username }),
      t('common.confirmDelete'),
      {
        confirmButtonText: t('common.delete'),
        cancelButtonText: t('common.cancel'),
        type: 'warning'
      }
    )
    
    await userApi.deleteUser(editingUser.value.id)
    closeUserDialog()
    loadUsers()
  } catch (err) {
    if (err !== 'cancel') {
      console.error('删除用户失败:', err)
      toast.error(t('settings.deleteUserFailed'))
    }
  }
}

// 重置密码
const handleResetPassword = async () => {
  if (!editingUser.value || !userForm.newPassword || userForm.newPassword.length < 6) return
  
  try {
    await userApi.resetPassword(editingUser.value.id, { password: userForm.newPassword })
    userForm.newPassword = ''
    toast.success(t('settings.resetPasswordSuccess'))
  } catch (err) {
    console.error('重置密码失败:', err)
    toast.error(t('settings.resetPasswordFailed'))
  }
}

// 用户头像上传
const handleUserAvatarUpload = async (event: Event) => {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  
  try {
    // 使用小头像压缩方法
    const result = await compressSmallAvatar(file)
    userForm.avatar = result.base64
    console.log(`用户头像压缩: ${Math.round(result.originalSize / 1024)}KB → ${Math.round(result.compressedSize / 1024)}KB`)
  } catch (err) {
    console.error('压缩用户头像失败:', err)
    toast.error(err instanceof Error ? err.message : t('settings.imageProcessFailed'))
  }
  input.value = ''
}

// 处理用户名输入，过滤非法字符
const handleUsernameInput = (event: Event) => {
  const input = event.target as HTMLInputElement
  // 只保留字母、数字、下划线
  let value = input.value.replace(/[^a-zA-Z0-9_]/g, '')
  // 确保第一个字符是字母（如果不是，则删除第一个字符）
  const firstChar = value[0]
  if (firstChar && !/^[a-zA-Z]$/.test(firstChar)) {
    value = value.substring(1)
  }
  // 限制最大长度为16
  if (value.length > 16) {
    value = value.substring(0, 16)
  }
  // 更新表单值
  userForm.username = value
  // 如果值被修改过，更新输入框显示
  if (input.value !== value) {
    input.value = value
  }
}

// 监听用户分页变化
watch(userPage, () => {
  loadUsers()
})

// 监听用户管理 tab 切换
watch(activeTab, (newTab) => {
  if (newTab === 'user' && usersList.value.length === 0) {
    loadUsers()
  }
  if (newTab === 'role' && rolesList.value.length === 0) {
    loadRolesForManagement()
  }
})

// 监听设置组切换，自动重置到第一个 tab
watch(currentGroup, (newGroup) => {
  const items = menuItemsByGroup[newGroup]
  if (items && items.length > 0 && items[0]) {
    activeTab.value = items[0].key
  }
})

// =====================
// 角色管理方法
// =====================

// 加载角色列表（用于角色管理）
const loadRolesForManagement = async () => {
  rolesLoading.value = true
  try {
    const roles = await roleApi.getRoles()
    rolesList.value = roles
  } catch (err) {
    console.error('加载角色列表失败:', err)
    toast.error(t('settings.loadRolesFailed'))
  } finally {
    rolesLoading.value = false
  }
}

// 加载所有权限列表
const loadAllPermissions = async () => {
  try {
    const permissions = await roleApi.getAllPermissions()
    allPermissions.value = permissions
  } catch (err) {
    console.error('加载权限列表失败:', err)
    toast.error(t('settings.loadPermissionsFailed'))
  }
}

// 加载所有专家列表
const loadAllExperts = async () => {
  try {
    const experts = await roleApi.getAllExperts()
    allExperts.value = experts
  } catch (err) {
    console.error('加载专家列表失败:', err)
    toast.error(t('settings.loadExpertsFailed'))
  }
}

// 选择角色
const selectRole = async (role: Role) => {
  selectedRole.value = role
  roleSubTab.value = 'permissions'
  
  // 加载角色的权限配置
  rolePermissionsLoading.value = true
  roleExpertsLoading.value = true
  
  try {
    const [permissionsData, expertsData] = await Promise.all([
      roleApi.getRolePermissions(role.id),
      roleApi.getRoleExperts(role.id),
    ])
    rolePermissionIds.value = permissionsData.permission_ids || []
    roleExpertIds.value = expertsData.expert_ids || []
    // 判断是否为管理员角色（expertsData 接口返回 is_admin）
    isAdminRole.value = expertsData.is_admin || false
    rolePermissionsChanged.value = false
    roleExpertsChanged.value = false
  } catch (err) {
    console.error('加载角色配置失败:', err)
  } finally {
    rolePermissionsLoading.value = false
    roleExpertsLoading.value = false
  }
}

// 打开角色编辑对话框
const openRoleDialog = (role: Role) => {
  editingRole.value = role
  roleForm.mark = role.mark
  roleForm.name = role.name
  roleForm.description = role.description || ''
  showRoleDialog.value = true
}

// 关闭角色编辑对话框
const closeRoleDialog = () => {
  showRoleDialog.value = false
  editingRole.value = null
}

// 保存角色基本信息
const saveRole = async () => {
  if (!editingRole.value) return
  
  try {
    const updateData: UpdateRoleRequest = {
      name: roleForm.name,
      description: roleForm.description,
    }
    await roleApi.updateRole(editingRole.value.id, updateData)
    
    // 更新本地列表
    const index = rolesList.value.findIndex(r => r.id === editingRole.value!.id)
    if (index !== -1) {
      const existingRole = rolesList.value[index]
      if (existingRole) {
        rolesList.value[index] = {
          id: existingRole.id,
          mark: existingRole.mark,
          name: roleForm.name,
          description: roleForm.description,
          is_system: existingRole.is_system,
        }
      }
    }
    
    // 更新选中角色
    if (selectedRole.value?.id === editingRole.value.id) {
      selectedRole.value = {
        ...selectedRole.value,
        name: roleForm.name,
        description: roleForm.description,
      }
    }
    
    closeRoleDialog()
  } catch (err) {
    console.error('保存角色失败:', err)
    toast.error(t('settings.saveRoleFailed'))
  }
}

// 保存角色权限配置
const saveRolePermissions = async () => {
  if (!selectedRole.value) return
  
  try {
    await roleApi.updateRolePermissions(selectedRole.value.id, {
      permission_ids: rolePermissionIds.value,
    })
    rolePermissionsChanged.value = false
    toast.success(t('settings.savePermissionsSuccess'))
  } catch (err) {
    console.error('保存权限配置失败:', err)
    toast.error(t('settings.savePermissionsFailed'))
  }
}

// 保存角色专家访问权限
const saveRoleExperts = async () => {
  if (!selectedRole.value) return
  
  try {
    await roleApi.updateRoleExperts(selectedRole.value.id, {
      expert_ids: roleExpertIds.value,
    })
    roleExpertsChanged.value = false
    toast.success(t('settings.saveExpertsSuccess'))
  } catch (err) {
    console.error('保存专家访问权限失败:', err)
    toast.error(t('settings.saveExpertsFailed'))
  }
}

const saveProfile = async () => {
  await userStore.updatePreferences({
    language: profileForm.language as 'zh-CN' | 'en-US',
  })
  locale.value = profileForm.language
}

// 修改密码
const handleChangePassword = async () => {
  if (!isPasswordFormValid.value) return

  passwordLoading.value = true
  try {
    await userApi.changePassword({
      old_password: passwordForm.old_password,
      new_password: passwordForm.new_password,
    })
    // 清空表单
    passwordForm.old_password = ''
    passwordForm.new_password = ''
    passwordForm.confirm_password = ''
    toast.success(t('settings.changePasswordSuccess'))
  } catch (err) {
    console.error('修改密码失败:', err)
    const errorMsg = err instanceof Error ? err.message : t('settings.changePasswordFailed')
    toast.error(errorMsg)
  } finally {
    passwordLoading.value = false
  }
}

// Provider 管理方法
const openProviderDialog = (provider?: ModelProvider) => {
  if (provider) {
    editingProvider.value = provider
    providerForm.name = provider.name
    providerForm.base_url = provider.base_url
    providerForm.api_key = '' // 编辑时不显示原有 API Key
    providerForm.timeout = provider.timeout
    providerForm.user_agent = provider.user_agent || ''
    providerForm.is_active = provider.is_active
  } else {
    editingProvider.value = null
    providerForm.name = ''
    providerForm.base_url = ''
    providerForm.api_key = ''
    providerForm.timeout = 30
    providerForm.user_agent = ''
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
        user_agent: providerForm.user_agent || undefined,
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
    const errorMsg = err instanceof Error ? err.message : t('settings.saveProviderFailed')
    toast.error(errorMsg)
  }
}

const confirmDeleteProviderFromDialog = async () => {
  if (!editingProvider.value) return
  
  try {
    await ElMessageBox.confirm(
      t('settings.deleteProviderConfirm', { name: editingProvider.value.name }),
      t('common.confirmDelete'),
      {
        confirmButtonText: t('common.delete'),
        cancelButtonText: t('common.cancel'),
        type: 'warning'
      }
    )
    
    await providerStore.deleteProvider(editingProvider.value.id)
    if (selectedProvider.value?.id === editingProvider.value.id) {
      selectedProvider.value = null
    }
    closeProviderDialog()
  } catch (err) {
    if (err !== 'cancel') {
      const errorMsg = err instanceof Error ? err.message : t('settings.deleteProviderFailed')
      toast.error(errorMsg)
    }
  }
}

// Model 管理方法
const openModelDialog = (model?: AIModel) => {
  if (model) {
    editingModel.value = model
    modelForm.name = model.name
    modelForm.model_name = model.model_name || ''
    modelForm.provider_id = model.provider_id || ''
    modelForm.model_type = (model as any).model_type || 'text'
    modelForm.max_tokens = model.max_tokens
    modelForm.max_output_tokens = model.max_output_tokens
    modelForm.embedding_dim = (model as any).embedding_dim
    modelForm.cost_per_1k_input = model.cost_per_1k_input
    modelForm.cost_per_1k_output = model.cost_per_1k_output
    modelForm.description = model.description || ''
    modelForm.supports_reasoning = model.supports_reasoning ?? false
    modelForm.thinking_format = model.thinking_format ?? 'none'
    modelForm.is_active = model.is_active
  } else {
    editingModel.value = null
    modelForm.name = ''
    modelForm.model_name = ''
    // 如果已选择提供商，默认使用该提供商
    modelForm.provider_id = selectedProvider.value?.id || ''
    modelForm.model_type = 'text'
    modelForm.max_tokens = undefined
    modelForm.max_output_tokens = undefined
    modelForm.embedding_dim = undefined
    modelForm.cost_per_1k_input = undefined
    modelForm.cost_per_1k_output = undefined
    modelForm.description = ''
    modelForm.supports_reasoning = false
    modelForm.thinking_format = 'none'
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
    const errorMsg = err instanceof Error ? err.message : t('settings.saveModelFailed')
    toast.error(errorMsg)
  }
}

const confirmDeleteModelFromDialog = async () => {
  if (!editingModel.value) return
  
  try {
    await ElMessageBox.confirm(
      t('settings.deleteModelConfirm', { name: editingModel.value.name }),
      t('common.confirmDelete'),
      {
        confirmButtonText: t('common.delete'),
        cancelButtonText: t('common.cancel'),
        type: 'warning'
      }
    )
    
    await modelStore.deleteModel(editingModel.value.id)
    closeModelDialog()
  } catch (err) {
    if (err !== 'cancel') {
      const errorMsg = err instanceof Error ? err.message : t('settings.deleteModelFailed')
      toast.error(errorMsg)
    }
  }
}

// Expert 管理方法
const openExpertDialog = (expert?: Expert) => {
  // 重置 Tab 到基本信息
  expertActiveTab.value = 'basic'
  
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
    expertForm.context_strategy = (expert as any).context_strategy ?? 'full'
    expertForm.context_threshold = expert.context_threshold ?? 0.70
    // LLM 参数
    expertForm.temperature = expert.temperature ?? 0.70
    expertForm.reflective_temperature = expert.reflective_temperature ?? 0.30
    expertForm.top_p = expert.top_p ?? 1.0
    expertForm.frequency_penalty = expert.frequency_penalty ?? 0.0
    expertForm.presence_penalty = expert.presence_penalty ?? 0.0
    // 工具调用配置
    expertForm.max_tool_rounds = expert.max_tool_rounds ?? null
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
    expertForm.context_strategy = 'full'
    expertForm.context_threshold = 0.70
    // LLM 参数默认值
    expertForm.temperature = 0.70
    expertForm.reflective_temperature = 0.30
    expertForm.top_p = 1.0
    expertForm.frequency_penalty = 0.0
    expertForm.presence_penalty = 0.0
    // 工具调用配置默认值
    expertForm.max_tool_rounds = null
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
    const errorMsg = err instanceof Error ? err.message : t('settings.saveExpertFailed')
    toast.error(errorMsg)
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
    toast.error(err instanceof Error ? err.message : t('settings.imageProcessFailed'))
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
    toast.error(err instanceof Error ? err.message : t('settings.imageProcessFailed'))
  }
  input.value = ''
}

const confirmDeleteExpert = async (expert: Expert) => {
  try {
    await ElMessageBox.confirm(
      t('settings.deleteExpertConfirm', { name: expert.name }),
      t('common.confirmDelete'),
      {
        confirmButtonText: t('common.delete'),
        cancelButtonText: t('common.cancel'),
        type: 'warning'
      }
    )
    
    await expertStore.deleteExpert(expert.id)
  } catch (err) {
    if (err !== 'cancel') {
      const errorMsg = err instanceof Error ? err.message : t('settings.deleteExpertFailed')
      toast.error(errorMsg)
    }
  }
}

const confirmDeleteExpertFromDialog = async () => {
  if (!editingExpert.value) return
  
  try {
    await ElMessageBox.confirm(
      t('settings.deleteExpertConfirm', { name: editingExpert.value.name }),
      t('common.confirmDelete'),
      {
        confirmButtonText: t('common.delete'),
        cancelButtonText: t('common.cancel'),
        type: 'warning'
      }
    )
    
    await expertStore.deleteExpert(editingExpert.value.id)
    closeExpertDialog()
  } catch (err) {
    if (err !== 'cancel') {
      const errorMsg = err instanceof Error ? err.message : t('settings.deleteExpertFailed')
      toast.error(errorMsg)
    }
  }
}

// 技能管理方法
const openSkillsDialog = async (expert: Expert) => {
  currentExpertForSkills.value = expert
  skillsSearchQuery.value = ''
  skillsChanged.value = false
  showSkillsDialog.value = true
  await loadExpertSkills(expert.id)
}

const closeSkillsDialog = () => {
  showSkillsDialog.value = false
  currentExpertForSkills.value = null
  skillsList.value = []
  skillsSearchQuery.value = ''
  skillsChanged.value = false
}

const loadExpertSkills = async (expertId: string) => {
  skillsLoading.value = true
  try {
    const response = await expertApi.getExpertSkills(expertId)
    skillsList.value = response.skills || []
  } catch (err) {
    console.error('加载技能列表失败:', err)
    toast.error(t('settings.loadSkillsFailed'))
  } finally {
    skillsLoading.value = false
  }
}

const handleSkillToggle = (skill: ExpertSkill) => {
  skillsChanged.value = true
}

const saveSkills = async () => {
  if (!currentExpertForSkills.value) return

  try {
    const skillConfigs: ExpertSkillConfig[] = skillsList.value.map(skill => ({
      skill_id: skill.id,
      is_enabled: skill.is_enabled
    }))

    await expertApi.updateExpertSkills(currentExpertForSkills.value.id, skillConfigs)
    skillsChanged.value = false
    closeSkillsDialog()
  } catch (err) {
    console.error('保存技能配置失败:', err)
    toast.error(t('settings.saveSkillsFailed'))
  }
}

// 监听提供商列表变化，如果当前选中的提供商被删除，清空选择
watch(() => providerStore.providers, (newProviders) => {
  if (selectedProvider.value && !newProviders.find(p => p.id === selectedProvider.value!.id)) {
    selectedProvider.value = null
  }
}, { deep: true })

// 技能筛选
const filteredSkills = computed(() => {
  if (!skillsSearchQuery.value.trim()) {
    return skillsList.value
  }
  const query = skillsSearchQuery.value.toLowerCase()
  return skillsList.value.filter(skill =>
    skill.name.toLowerCase().includes(query) ||
    (skill.description && skill.description.toLowerCase().includes(query))
  )
})

// 启用的技能数量
const enabledSkillsCount = computed(() => {
  return skillsList.value.filter(s => s.is_enabled).length
})

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
  // 加载权限列表和专家列表（用于角色管理）- 仅管理员需要
  if (isAdmin.value) {
    loadAllPermissions()
    loadAllExperts()
  }
})
</script>

<style scoped>
.settings-view {
  display: flex;
  width: 100%;
  height: 100%;
  min-height: calc(100vh - 64px);
}

/* 设置菜单样式 */
/* Element Plus el-menu 样式覆盖 */
.settings-sidebar.el-menu {
  flex: 0 0 220px;
  border-right: 1px solid var(--el-menu-border-color);
}

.settings-sidebar.el-menu--collapse {
  flex-basis: 64px;
}

.settings-main {
  flex: 1;
  padding: 24px;
  overflow-y: auto;
  transition: padding 0.3s ease;
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

.badge.embedding {
  background: var(--primary-light-bg, #e8f4fe);
  color: var(--primary-color, #7c5c3d);
}

.badge.chat {
  background: var(--bg-secondary, #e9ecef);
  color: var(--text-secondary, #6c7780);
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
  overflow-y: auto;
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
@media (max-width: 768px) {
  .settings-view {
    flex-direction: column;
    min-height: auto;
  }

  .settings-sidebar {
    flex: none;
    width: 100%;
    border-right: none;
    border-bottom: 1px solid var(--border-color, #e0e0e0);
  }

  .settings-sidebar.el-menu--collapse {
    flex-basis: auto;
  }

  .settings-main {
    padding: 16px;
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

/* 技能按钮 */
.btn-skills {
  padding: 4px 10px;
  background: white;
  border: 1px solid var(--primary-color, #2196f3);
  border-radius: 6px;
  font-size: 12px;
  color: var(--primary-color, #2196f3);
  cursor: pointer;
  transition: all 0.2s;
  flex-shrink: 0;
}

.btn-skills:hover {
  background: var(--primary-color, #2196f3);
  color: white;
}

/* 技能管理对话框 */
.skills-dialog-body {
  padding: 16px 24px;
}

.skills-search {
  margin-bottom: 16px;
}

.skills-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 400px;
  overflow-y: auto;
}

.skill-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  background: var(--secondary-bg, #f8f9fa);
  border: 1px solid transparent;
  border-radius: 10px;
  transition: all 0.2s;
}

.skill-item:hover {
  background: var(--hover-bg, #e8e8e8);
  border-color: var(--border-color, #e0e0e0);
}

.skill-item.builtin {
  background: var(--secondary-bg, #f8f9fa);
  border-color: var(--border-color, #e0e0e0);
}

.skill-item.builtin:hover {
  background: var(--hover-bg, #e8e8e8);
}

.skill-info {
  flex: 1;
  min-width: 0;
}

.skill-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 4px;
}

.skill-name {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary, #333);
}

.skill-description {
  font-size: 12px;
  color: var(--text-secondary, #666);
  margin: 0;
  line-height: 1.4;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.badge.builtin {
  background: var(--secondary-bg, #e8e8e8);
  color: var(--text-secondary, #666);
  font-size: 10px;
  padding: 2px 8px;
  border-radius: 4px;
  font-weight: 500;
}

/* 切换开关 */
.skill-toggle {
  position: relative;
  display: inline-block;
  width: 48px;
  height: 26px;
  margin-left: 12px;
  flex-shrink: 0;
}

.skill-toggle input {
  opacity: 0;
  width: 0;
  height: 0;
}

.toggle-slider {
  position: absolute;
  cursor: pointer;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: #ccc;
  transition: .3s;
  border-radius: 26px;
}

.toggle-slider:before {
  position: absolute;
  content: "";
  height: 20px;
  width: 20px;
  left: 3px;
  bottom: 3px;
  background-color: white;
  transition: .3s;
  border-radius: 50%;
}

.skill-toggle input:checked + .toggle-slider {
  background: var(--primary-color, #2196f3);
}

.skill-toggle input:checked + .toggle-slider:before {
  transform: translateX(22px);
}

.skills-count {
  font-size: 13px;
  color: var(--text-secondary, #666);
}

/* 响应式调整 */
@media (max-width: 768px) {
  .skill-item {
    flex-direction: column;
    align-items: flex-start;
    gap: 12px;
  }

  .skill-toggle {
    margin-left: 0;
    align-self: flex-end;
  }
}

/* 用户管理区域 */
.user-section {
  padding: 0;
  overflow: hidden;
}

.user-section .panel-header {
  padding: 16px 20px;
  border-bottom: 1px solid var(--border-color, #e0e0e0);
  background: var(--card-bg, #fff);
}

.user-search {
  padding: 16px;
  border-bottom: 1px solid var(--border-color, #e0e0e0);
}

.user-search .form-input {
  width: 100%;
  max-width: 400px;
}

.user-list-container {
  display: flex;
  flex-direction: column;
  min-height: 400px;
}

.user-list {
  flex: 1;
  padding: 16px;
  overflow-y: auto;
  max-height: calc(100vh - 320px);
}

.user-item {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 16px;
  margin-bottom: 12px;
  border-radius: 10px;
  background: var(--secondary-bg, #f8f9fa);
  border: 1px solid transparent;
  transition: all 0.2s;
}

.user-item:hover {
  background: var(--hover-bg, #e8e8e8);
  border-color: var(--border-color, #e0e0e0);
}

.user-item.inactive {
  opacity: 0.6;
}

.user-avatar {
  width: 48px;
  height: 48px;
  border-radius: 50%;
  background: var(--border-color, #e0e0e0);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 24px;
  flex-shrink: 0;
  overflow: hidden;
}

.user-avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.user-info {
  flex: 1;
  min-width: 0;
}

.user-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 4px;
  flex-wrap: wrap;
}

.user-name {
  font-size: 15px;
  font-weight: 600;
  color: var(--text-primary, #333);
}

.user-roles {
  font-size: 12px;
  color: var(--primary-color, #2196f3);
  background: var(--primary-light, #e3f2fd);
  padding: 2px 8px;
  border-radius: 4px;
}

.user-meta {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 13px;
  color: var(--text-secondary, #666);
}

.user-email {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.user-invitation-quota {
  font-size: 12px;
  color: var(--primary-color, #2196f3);
  background: var(--primary-light, #e3f2fd);
  padding: 2px 8px;
  border-radius: 4px;
  flex-shrink: 0;
}

.user-actions {
  display: flex;
  gap: 8px;
  flex-shrink: 0;
}

/* 重置密码行 */
.reset-password-row {
  display: flex;
  gap: 12px;
  align-items: center;
}

.reset-password-row .form-input {
  flex: 1;
}

.reset-password-row .btn-small {
  flex-shrink: 0;
}

/* 响应式调整 - 用户管理 */
@media (max-width: 768px) {
  .user-item {
    flex-direction: column;
    align-items: flex-start;
  }

  .user-actions {
    align-self: flex-end;
    margin-top: 8px;
  }

  .user-meta {
    flex-direction: column;
    align-items: flex-start;
    gap: 4px;
  }

  .reset-password-row {
    flex-direction: column;
    align-items: stretch;
  }

  .reset-password-row .btn-small {
    width: 100%;
  }
}

/* 角色选择样式 */
.roles-checkbox-group {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}

.role-checkbox {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
  background: var(--secondary-bg, #f8f9fa);
  border: 1px solid var(--border-color, #e0e0e0);
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s;
}

.role-checkbox:hover {
  background: var(--hover-bg, #e8e8e8);
  border-color: var(--primary-color, #2196f3);
}

.role-checkbox input[type="checkbox"] {
  width: 16px;
  height: 16px;
  cursor: pointer;
  accent-color: var(--primary-color, #2196f3);
}

.role-checkbox input[type="checkbox"]:disabled {
  cursor: not-allowed;
  opacity: 0.6;
}

.role-label {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  color: var(--text-primary, #333);
}

/* 角色管理区域 */
.role-section {
  padding: 0;
  overflow: hidden;
}

.role-list-panel {
  flex: 0 0 280px;
  border-right: 1px solid var(--border-color, #e0e0e0);
  background: var(--secondary-bg, #f8f9fa);
}

.role-detail-panel {
  flex: 1;
  display: flex;
  flex-direction: column;
  background: var(--card-bg, #fff);
}

.role-list-container {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.role-list {
  flex: 1;
  overflow-y: auto;
  padding: 8px;
}

.role-item {
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

.role-item:hover {
  background: var(--hover-bg, #e8e8e8);
}

.role-item.active {
  background: var(--primary-light, #e3f2fd);
  border-color: var(--primary-color, #2196f3);
}

.role-item.system {
  opacity: 0.8;
}

.role-name-btn {
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

.role-name {
  font-size: 14px;
  font-weight: 500;
  color: var(--text-primary, #333);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.badge.system {
  background: var(--secondary-bg, #e8e8e8);
  color: var(--text-secondary, #666);
}

.select-role-hint {
  color: var(--text-tertiary, #999);
  font-style: italic;
  padding: 60px 40px;
}

/* 子 Tab 切换 */
.role-sub-tabs {
  display: flex;
  gap: 0;
  border-bottom: 1px solid var(--border-color, #e0e0e0);
  background: var(--card-bg, #fff);
}

.sub-tab-btn {
  padding: 14px 24px;
  background: none;
  border: none;
  border-bottom: 2px solid transparent;
  font-size: 14px;
  color: var(--text-secondary, #666);
  cursor: pointer;
  transition: all 0.2s;
}

.sub-tab-btn:hover {
  color: var(--text-primary, #333);
  background: var(--secondary-bg, #f5f5f5);
}

.sub-tab-btn.active {
  color: var(--primary-color, #2196f3);
  border-bottom-color: var(--primary-color, #2196f3);
  background: var(--card-bg, #fff);
}

.role-tab-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
}

.permissions-list,
.experts-list {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
  min-height: 0;
  max-height: calc(100vh - 320px);
}

.permission-item,
.expert-access-item {
  margin-bottom: 8px;
}

.permission-checkbox,
.expert-checkbox {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 12px 16px;
  background: var(--secondary-bg, #f8f9fa);
  border: 1px solid transparent;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s;
}

.permission-checkbox:hover,
.expert-checkbox:hover {
  background: var(--hover-bg, #e8e8e8);
  border-color: var(--border-color, #e0e0e0);
}

.permission-checkbox input,
.expert-checkbox input {
  width: 18px;
  height: 18px;
  margin-top: 2px;
  flex-shrink: 0;
  cursor: pointer;
  accent-color: var(--primary-color, #2196f3);
}

.permission-info,
.expert-info {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.permission-name,
.expert-access-item .expert-name {
  font-size: 14px;
  font-weight: 500;
  color: var(--text-primary, #333);
}

.permission-desc,
.expert-access-item .expert-intro {
  font-size: 12px;
  color: var(--text-secondary, #666);
  line-height: 1.4;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.role-tab-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px 20px;
  border-top: 1px solid var(--border-color, #e0e0e0);
  background: var(--card-bg, #fff);
}

.permissions-count,
.experts-count {
  font-size: 13px;
  color: var(--text-secondary, #666);
}

/* 响应式调整 - 角色管理 */
@media (max-width: 768px) {
  .role-list-panel {
    flex: none;
    width: 100%;
    border-right: none;
    border-bottom: 1px solid var(--border-color, #e0e0e0);
    max-height: 250px;
  }

  .role-detail-panel {
    flex: none;
    min-height: 300px;
  }

  .role-sub-tabs {
    flex-wrap: wrap;
  }

  .sub-tab-btn {
    flex: 1;
    text-align: center;
  }
}

/* 专家对话框 Tab 样式 */
.expert-dialog .dialog-body {
  padding: 0;
}

.expert-tabs {
  display: flex;
  gap: 0;
  border-bottom: 1px solid var(--border-color, #e0e0e0);
  background: var(--secondary-bg, #f8f9fa);
  padding: 0 24px;
}

.expert-tab-btn {
  padding: 14px 24px;
  background: none;
  border: none;
  border-bottom: 2px solid transparent;
  font-size: 14px;
  font-weight: 500;
  color: var(--text-secondary, #666);
  cursor: pointer;
  transition: all 0.2s;
}

.expert-tab-btn:hover {
  color: var(--text-primary, #333);
  background: var(--hover-bg, #e8e8e8);
}

.expert-tab-btn.active {
  color: var(--primary-color, #2196f3);
  border-bottom-color: var(--primary-color, #2196f3);
  background: var(--card-bg, #fff);
}

.expert-tab-content {
  padding: 24px;
  max-height: 60vh;
  overflow-y: auto;
}

.expert-tab-pane {
  animation: fadeIn 0.2s ease-in-out;
}

@keyframes fadeIn {
  from {
    opacity: 0;
    transform: translateY(-8px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

/* 个人资料子 Tab 样式 */
.profile-section {
  padding: 0;
  overflow: hidden;
}

.profile-sub-tabs {
  display: flex;
  gap: 0;
  border-bottom: 1px solid var(--border-color, #e0e0e0);
  background: var(--card-bg, #fff);
}

.profile-tab-content {
  padding: 24px;
}

.profile-tab-content .btn-save {
  margin-top: 8px;
}
</style>
