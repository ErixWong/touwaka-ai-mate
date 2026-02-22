import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { apiCall } from '@/api/client'
import type { Skill, SkillTool, SkillFormData } from '@/types'

export const useSkillStore = defineStore('skill', () => {
  const skills = ref<Skill[]>([])
  const isLoading = ref(false)
  const error = ref<string | null>(null)
  const currentSkill = ref<Skill | null>(null)

  // 获取技能列表
  const loadSkills = async () => {
    isLoading.value = true
    error.value = null
    try {
      const response = await apiCall<{ skills: Skill[] }>('/skills')
      skills.value = response.skills || []
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to load skills'
      throw err
    } finally {
      isLoading.value = false
    }
  }

  // 获取单个技能详情
  const loadSkill = async (skillId: string) => {
    isLoading.value = true
    error.value = null
    try {
      const response = await apiCall<{ skill: Skill }>(`/skills/${skillId}`)
      currentSkill.value = response.skill
      return response.skill
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to load skill'
      throw err
    } finally {
      isLoading.value = false
    }
  }

  // 从 URL 安装技能
  const installFromUrl = async (url: string) => {
    isLoading.value = true
    error.value = null
    try {
      const response = await apiCall<{ skill: Skill }>('/skills/from-url', {
        method: 'POST',
        body: { url }
      })
      skills.value.push(response.skill)
      return response.skill
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to install skill from URL'
      throw err
    } finally {
      isLoading.value = false
    }
  }

  // 从 ZIP 文件安装技能
  const installFromZip = async (file: File) => {
    isLoading.value = true
    error.value = null
    try {
      const formData = new FormData()
      formData.append('file', file)
      
      const response = await apiCall<{ skill: Skill }>('/skills/from-zip', {
        method: 'POST',
        body: formData
      })
      skills.value.push(response.skill)
      return response.skill
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to install skill from ZIP'
      throw err
    } finally {
      isLoading.value = false
    }
  }

  // 从本地路径安装技能
  const installFromPath = async (path: string) => {
    isLoading.value = true
    error.value = null
    try {
      const response = await apiCall<{ skill: Skill }>('/skills/from-path', {
        method: 'POST',
        body: { path }
      })
      skills.value.push(response.skill)
      return response.skill
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to install skill from path'
      throw err
    } finally {
      isLoading.value = false
    }
  }

  // 更新技能
  const updateSkill = async (skillId: string, data: Partial<SkillFormData>) => {
    isLoading.value = true
    error.value = null
    try {
      const response = await apiCall<{ skill: Skill }>(`/skills/${skillId}`, {
        method: 'PUT',
        body: data
      })
      const index = skills.value.findIndex(s => s.id === skillId)
      if (index !== -1) {
        skills.value[index] = response.skill
      }
      return response.skill
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to update skill'
      throw err
    } finally {
      isLoading.value = false
    }
  }

  // 删除技能
  const deleteSkill = async (skillId: string) => {
    isLoading.value = true
    error.value = null
    try {
      await apiCall(`/skills/${skillId}`, {
        method: 'DELETE'
      })
      skills.value = skills.value.filter(s => s.id !== skillId)
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to delete skill'
      throw err
    } finally {
      isLoading.value = false
    }
  }

  // 重新分析技能
  const reanalyzeSkill = async (skillId: string) => {
    isLoading.value = true
    error.value = null
    try {
      const response = await apiCall<{ skill: Skill }>(`/skills/${skillId}/reanalyze`, {
        method: 'POST'
      })
      const index = skills.value.findIndex(s => s.id === skillId)
      if (index !== -1) {
        skills.value[index] = response.skill
      }
      return response.skill
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to reanalyze skill'
      throw err
    } finally {
      isLoading.value = false
    }
  }

  // 切换技能激活状态
  const toggleSkillActive = async (skillId: string) => {
    const skill = skills.value.find(s => s.id === skillId)
    if (skill) {
      return updateSkill(skillId, { is_active: !skill.is_active })
    }
  }

  // 按标签过滤
  const getSkillsByTag = (tag: string) => {
    return skills.value.filter(s => s.tags?.includes(tag))
  }

  // 搜索技能
  const searchSkills = (query: string) => {
    const lowerQuery = query.toLowerCase()
    return skills.value.filter(s => 
      s.name.toLowerCase().includes(lowerQuery) ||
      s.description?.toLowerCase().includes(lowerQuery) ||
      s.tags?.some(t => t.toLowerCase().includes(lowerQuery))
    )
  }

  return {
    skills,
    isLoading,
    error,
    currentSkill,
    loadSkills,
    loadSkill,
    installFromUrl,
    installFromZip,
    installFromPath,
    updateSkill,
    deleteSkill,
    reanalyzeSkill,
    toggleSkillActive,
    getSkillsByTag,
    searchSkills
  }
})
