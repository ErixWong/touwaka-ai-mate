import { ref, computed } from 'vue'
import { defineStore } from 'pinia'
import { skill_api } from '@/api/services'
import type { Skill, SkillDetail, SkillTool } from '@/types'

/**
 * 技能目录项（用于目录树展示）
 */
export interface SkillDirectoryItem {
  name: string           // 技能名称
  path: string           // 完整路径（如 data/skills/file-operations）
  description?: string   // 描述
  tools?: SkillTool[]    // 工具列表
  is_registered: boolean // 是否已注册
  skill_id?: string      // 注册后的技能ID
}

/**
 * 当前工作技能（用于限制文件操作路径）
 */
export interface WorkingSkill {
  name: string
  path: string
  skill_id?: string
}

/**
 * SkillDirectory Store
 *
 * 技能目录状态管理
 * - 管理技能目录列表
 * - 跟踪当前选中的技能目录
 * - 管理当前工作技能（用于限制文件操作路径）
 * - 与 taskStore 互斥（不能同时处于任务模式和技能模式）
 *
 * 设计说明：
 * - selectedSkill: 当前选中的技能目录（用于显示信息）
 * - currentWorkingSkill: 当前工作技能（用于限制文件操作路径）
 * - 与任务模式互斥：进入技能模式时检查任务状态
 */
export const useSkillDirectoryStore = defineStore('skillDirectory', () => {
  // State
  const skillDirectories = ref<SkillDirectoryItem[]>([])
  const selectedSkill = ref<SkillDirectoryItem | null>(null)
  const currentWorkingSkill = ref<WorkingSkill | null>(null)
  const currentBrowsePath = ref<string>('')
  const isLoading = ref(false)
  const error = ref<string | null>(null)

  // Getters
  const isInSkillMode = computed(() => currentWorkingSkill.value !== null)

  const currentSkillName = computed(() =>
    currentWorkingSkill.value?.name || null
  )

  const currentSkillPath = computed(() =>
    currentWorkingSkill.value?.path || null
  )

  // Actions

  /**
   * 加载技能目录列表
   * 从已注册的技能列表中构建目录项
   */
  const loadSkillDirectories = async () => {
    isLoading.value = true
    error.value = null
    try {
      const response = await skill_api.list_all_skills({ include_inactive: true })
      const skills = response.skills || []

      // 构建技能目录项
      skillDirectories.value = skills.map((skill: Skill) => ({
        name: skill.name,
        path: skill.source_path || `data/skills/${skill.name}`,
        description: skill.description,
        tools: skill.tools,
        is_registered: true,
        skill_id: skill.id
      }))

      return skillDirectories.value
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to load skill directories'
      throw err
    } finally {
      isLoading.value = false
    }
  }

  /**
   * 加载技能详情
   */
  const loadSkillDetail = async (skillId: string): Promise<SkillDetail | null> => {
    try {
      const response = await skill_api.get_skill_detail(skillId)
      return response.skill
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to load skill detail'
      return null
    }
  }

  /**
   * 选择技能目录（用于显示信息）
   */
  const selectSkill = (skill: SkillDirectoryItem | null) => {
    selectedSkill.value = skill
  }

  /**
   * 设置当前工作技能
   * 用于限制文件操作路径
   */
  const setCurrentWorkingSkill = (skill: WorkingSkill | null) => {
    currentWorkingSkill.value = skill
  }

  /**
   * 进入技能模式
   * 设置当前工作技能，用于限制文件操作路径
   */
  const enterSkillMode = (skill: SkillDirectoryItem) => {
    if (!skill || !skill.name) {
      console.warn('enterSkillMode called with invalid skill')
      return false
    }

    currentWorkingSkill.value = {
      name: skill.name,
      path: skill.path,
      skill_id: skill.skill_id
    }

    currentBrowsePath.value = ''
    return true
  }

  /**
   * 退出技能模式
   */
  const exitSkillMode = () => {
    currentWorkingSkill.value = null
    currentBrowsePath.value = ''
  }

  /**
   * 设置当前浏览路径
   */
  const setBrowsePath = (path: string) => {
    currentBrowsePath.value = path
  }

  /**
   * 清除错误
   */
  const clearError = () => {
    error.value = null
  }

  /**
   * 重置状态
   */
  const reset = () => {
    skillDirectories.value = []
    selectedSkill.value = null
    currentWorkingSkill.value = null
    currentBrowsePath.value = ''
    error.value = null
  }

  return {
    // State
    skillDirectories,
    selectedSkill,
    currentWorkingSkill,
    currentBrowsePath,
    isLoading,
    error,

    // Getters
    isInSkillMode,
    currentSkillName,
    currentSkillPath,

    // Actions
    loadSkillDirectories,
    loadSkillDetail,
    selectSkill,
    setCurrentWorkingSkill,
    enterSkillMode,
    exitSkillMode,
    setBrowsePath,
    clearError,
    reset,
  }
})