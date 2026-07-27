<template>
  <el-tabs v-model="profileSubTab" class="profile-tabs">
    <el-tab-pane :label="$t('settings.profileBasic')" name="basic">
      <el-form label-width="80px">
        <el-form-item :label="$t('settings.nickname')">
          <el-input v-model="profileForm.nickname" />
        </el-form-item>
        <el-form-item :label="$t('settings.language')">
          <el-select v-model="profileForm.language">
            <el-option label="中文" value="zh-CN" />
            <el-option label="English" value="en-US" />
          </el-select>
        </el-form-item>
      </el-form>
      <el-button type="primary" @click="saveProfile">{{ $t('settings.save') }}</el-button>
    </el-tab-pane>

    <el-tab-pane :label="$t('settings.changePassword')" name="password">
      <el-form label-width="100px">
        <el-form-item :label="$t('settings.oldPassword')">
          <el-input
            v-model="passwordForm.old_password"
            type="password"
            :placeholder="$t('settings.oldPasswordPlaceholder')"
            show-password
          />
        </el-form-item>
        <el-form-item :label="$t('settings.newPassword')">
          <el-input
            v-model="passwordForm.new_password"
            type="password"
            :placeholder="$t('settings.newPasswordPlaceholder')"
            show-password
          />
        </el-form-item>
        <el-form-item :label="$t('settings.confirmPassword')">
          <el-input
            v-model="passwordForm.confirm_password"
            type="password"
            :placeholder="$t('settings.confirmPasswordPlaceholder')"
            show-password
          />
        </el-form-item>
      </el-form>
      <el-button
        type="primary"
        :disabled="!isPasswordFormValid || passwordLoading"
        @click="handleChangePassword"
      >
        {{ passwordLoading ? $t('common.saving') : $t('settings.changePasswordBtn') }}
      </el-button>
    </el-tab-pane>
  </el-tabs>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { userApi } from '@/api/services'
import { useToastStore } from '@/stores/toast'
import { useUserStore } from '@/stores/user'

const { t, locale } = useI18n()
const userStore = useUserStore()
const toast = useToastStore()

const profileSubTab = ref<'basic' | 'password'>('basic')

const profileForm = reactive({
  nickname: '',
  language: 'zh-CN',
})

const passwordForm = reactive({
  old_password: '',
  new_password: '',
  confirm_password: '',
})
const passwordLoading = ref(false)

const isPasswordFormValid = computed(() => {
  return (
    passwordForm.old_password.length >= 6 &&
    passwordForm.new_password.length >= 6 &&
    passwordForm.new_password === passwordForm.confirm_password
  )
})

const saveProfile = async () => {
  await userStore.updatePreferences({
    language: profileForm.language as 'zh-CN' | 'en-US',
  })
  locale.value = profileForm.language
}

const handleChangePassword = async () => {
  if (!isPasswordFormValid.value) return

  passwordLoading.value = true
  try {
    await userApi.changePassword({
      old_password: passwordForm.old_password,
      new_password: passwordForm.new_password,
    })
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

onMounted(() => {
  if (userStore.user) {
    profileForm.nickname = userStore.user.nickname || ''
    profileForm.language = userStore.preferences?.language || 'zh-CN'
  }
})
</script>
