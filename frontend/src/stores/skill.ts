import { defineStore } from 'pinia'
import { ref } from 'vue'
import apiClient, { apiRequest } from '@/api/client'
import type { Skill, SkillFormData } from '@/types'

export const useSkillStore = defineStore('skill', () => {
  const skills = ref<Skill[]>([])
  const isLoading = ref(false)
  const error = ref<string | null>(null)
  const currentSkill = ref<Skill | null>(null)

  const loadSkills = async () => {
    isLoading.value = true
    error.value = null
    try {
      const response = await apiRequest<{ skills: Skill[] }>(apiClient.get('/skills'))
      skills.value = response.skills || []
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to load skills'
      throw err
    } finally {
      isLoading.value = false
    }
  }

  const loadSkill = async (skillId: string) => {
    isLoading.value = true
    error.value = null
    try {
      const response = await apiRequest<{ skill: Skill }>(apiClient.get(`/skills/${skillId}`))
      currentSkill.value = response.skill
      return response.skill
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to load skill'
      throw err
    } finally {
      isLoading.value = false
    }
  }

  /**
   * 更新或添加技能到列表（避免重复）
   */
  const upsertSkill = (skill: Skill) => {
    const index = skills.value.findIndex(s => s.id === skill.id)
    if (index !== -1) {
      skills.value[index] = skill
    } else {
      skills.value.push(skill)
    }
  }

  const updateSkill = async (skillId: string, data: Partial<SkillFormData>) => {
    isLoading.value = true
    error.value = null
    try {
      const response = await apiRequest<{ skill: Skill }>(apiClient.put(`/skills/${skillId}`, data))
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

  const deleteSkill = async (skillId: string) => {
    isLoading.value = true
    error.value = null
    try {
      await apiRequest<void>(apiClient.delete(`/skills/${skillId}`))
      skills.value = skills.value.filter(s => s.id !== skillId)
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to delete skill'
      throw err
    } finally {
      isLoading.value = false
    }
  }

  const toggleSkillActive = async (skillId: string) => {
    const skill = skills.value.find(s => s.id === skillId)
    if (skill) {
      return updateSkill(skillId, { is_active: !skill.is_active })
    }
  }

  const getSkillsByTag = (tag: string) => {
    return skills.value.filter(s => s.tags?.includes(tag))
  }

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
    updateSkill,
    deleteSkill,
    toggleSkillActive,
    getSkillsByTag,
    searchSkills
  }
})
