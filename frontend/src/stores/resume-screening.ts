import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import mockData from '@/data/resume-screening-mock.json'

export type JobStatus = 'draft' | 'open' | 'paused' | 'closed'
export type EmploymentType = 'full_time' | 'part_time' | 'intern' | 'contract'
export type WorkMode = 'onsite' | 'hybrid' | 'remote'
export type CandidateStatus = 'new' | 'active' | 'on_hold' | 'hired' | 'archived'
export type SourceChannel = 'upload' | 'referral' | 'import' | 'hunter'
export type ResumeParseStatus = 'pending' | 'processing' | 'success' | 'failed' | 'needs_review'
export type FileType = 'pdf' | 'docx' | 'doc'
export type FitLevel = 'A' | 'B' | 'C' | 'D'
export type MatchDecision = 'pending_review' | 'interview' | 'hold' | 'reject'

export interface Job {
  id: string
  job_code: string
  title: string
  dept_name: string
  employment_type: EmploymentType
  work_mode: WorkMode
  location_city: string
  description_md: string
  must_have_skills: string[]
  nice_to_have_skills: string[]
  min_years_experience: number
  education_requirement: string
  status: JobStatus
  owner_user_id: string
  opened_at: string | null
  closed_at: string | null
}

export interface Candidate {
  id: string
  name: string
  email: string
  phone: string
  location_city: string
  location_country: string
  current_company: string
  current_title: string
  total_years_experience: number
  target_roles: string[]
  target_industries: string[]
  target_locations: string[]
  target_salary_min: number
  target_salary_max: number
  salary_currency: string
  highest_education: string
  major: string
  skills: string[]
  languages: string[]
  profile_summary: string
  data_completeness_score: number
  status: CandidateStatus
  source_channel: SourceChannel
  created_at: string
  updated_at: string
}

export interface Resume {
  id: string
  candidate_id: string
  attachment_id: string
  file_name: string
  file_type: FileType
  file_hash: string
  parse_status: ResumeParseStatus
  raw_text_excerpt: string
  structured_version: string
  uploaded_at: string
  parsed_at: string | null
}

export interface CandidateExperience {
  id: string
  candidate_id: string
  project_name: string
  role: string
  start_date: string
  end_date: string | null
  is_current: boolean
  description: string
  responsibilities: string[]
  tech_stack: string[]
  industry_tags: string[]
  team_size: number
  outcome: string
}

export interface CandidateEducation {
  id: string
  candidate_id: string
  school_name: string
  degree: string
  major: string
  start_date: string
  end_date: string
  gpa: string
  courses: string[]
  honors: string[]
}

export interface MatchResult {
  id: string
  job_id: string
  candidate_id: string
  overall_score: number
  fit_level: FitLevel
  score_breakdown: {
    skill_score: number
    project_score: number
    industry_score: number
    education_score: number
    constraint_score: number
    completeness_score: number
  }
  highlights: string[]
  risks: string[]
  evidence: string[]
  decision: MatchDecision
  decision_reason: string
  matched_at: string
}

export interface DashboardStats {
  pendingParseResumes: number
  pendingManualCompare: number
  pendingAutoResults: number
  funnel: { label: string; count: number }[]
  avgProcessTime: number
  top10AcceptRate: number
  parseFailRate: number
}

interface RawMockData {
  meta: { app_id: string; version: string; generated_at: string; notes: string }
  jobs: Job[]
  candidates: Candidate[]
  resumes: Resume[]
  experiences: CandidateExperience[]
  educations: CandidateEducation[]
  match_results: MatchResult[]
}

export const useResumeScreeningStore = defineStore('resume-screening', () => {
  const data = ref<RawMockData>(mockData as RawMockData)

  const jobs = computed(() => data.value.jobs)
  const candidates = computed(() => data.value.candidates)
  const resumes = computed(() => data.value.resumes)
  const experiences = computed(() => data.value.experiences)
  const educations = computed(() => data.value.educations)
  const matchResults = computed(() => data.value.match_results)

  function candidateById(id: string) {
    return data.value.candidates.find(c => c.id === id) ?? null
  }

  function jobById(id: string) {
    return data.value.jobs.find(j => j.id === id) ?? null
  }

  function experiencesByCandidate(candidateId: string) {
    return data.value.experiences.filter(e => e.candidate_id === candidateId)
  }

  function educationsByCandidate(candidateId: string) {
    return data.value.educations.filter(e => e.candidate_id === candidateId)
  }

  function resumesByCandidate(candidateId: string) {
    return data.value.resumes.filter(r => r.candidate_id === candidateId)
  }

  function matchResultsByJob(jobId: string) {
    return data.value.match_results.filter(m => m.job_id === jobId)
  }

  function matchResultsByCandidate(candidateId: string) {
    return data.value.match_results.filter(m => m.candidate_id === candidateId)
  }

  const dashboardStats = computed<DashboardStats>(() => {
    const pendingParse = data.value.resumes.filter(r => r.parse_status === 'pending' || r.parse_status === 'processing' || r.parse_status === 'needs_review').length
    const totalMatchResults = data.value.match_results.length
    const pendingAuto = data.value.match_results.filter(m => m.decision === 'pending_review').length
    const interviewCount = data.value.match_results.filter(m => m.decision === 'interview').length
    const top10Results = data.value.match_results.filter(m => m.fit_level === 'A').length
    const parseFailed = data.value.resumes.filter(r => r.parse_status === 'failed').length
    const totalResumes = data.value.resumes.length || 1

    return {
      pendingParseResumes: pendingParse,
      pendingManualCompare: data.value.candidates.filter(c => c.status === 'new').length,
      pendingAutoResults: pendingAuto,
      funnel: [
        { label: '投递数', count: data.value.resumes.length },
        { label: '可解析数', count: data.value.resumes.filter(r => r.parse_status === 'success').length },
        { label: '入围数', count: totalMatchResults },
        { label: '面试数', count: interviewCount },
        { label: 'Offer数', count: 0 },
      ],
      avgProcessTime: 3.2,
      top10AcceptRate: top10Results > 0 ? Math.round((interviewCount / top10Results) * 100) : 0,
      parseFailRate: Math.round((parseFailed / totalResumes) * 100),
    }
  })

  function addJob(job: Job) {
    data.value.jobs.push(job)
  }

  function updateJob(id: string, updates: Partial<Job>) {
    const item = data.value.jobs.find(j => j.id === id)
    if (item) Object.assign(item, updates)
  }

  function addCandidate(candidate: Candidate) {
    data.value.candidates.push(candidate)
  }

  function updateCandidate(id: string, updates: Partial<Candidate>) {
    const item = data.value.candidates.find(c => c.id === id)
    if (item) Object.assign(item, updates)
  }

  function addExperience(exp: CandidateExperience) {
    data.value.experiences.push(exp)
  }

  function updateExperience(id: string, updates: Partial<CandidateExperience>) {
    const item = data.value.experiences.find(e => e.id === id)
    if (item) Object.assign(item, updates)
  }

  function deleteExperience(id: string) {
    data.value.experiences = data.value.experiences.filter(e => e.id !== id)
  }

  function addEducation(edu: CandidateEducation) {
    data.value.educations.push(edu)
  }

  function updateEducation(id: string, updates: Partial<CandidateEducation>) {
    const item = data.value.educations.find(e => e.id === id)
    if (item) Object.assign(item, updates)
  }

  function deleteEducation(id: string) {
    data.value.educations = data.value.educations.filter(e => e.id !== id)
  }

  function addMatchResult(mr: MatchResult) {
    data.value.match_results.push(mr)
  }

  function updateMatchResult(id: string, updates: Partial<MatchResult>) {
    const item = data.value.match_results.find(m => m.id === id)
    if (item) Object.assign(item, updates)
  }

  function addResume(resume: Resume) {
    data.value.resumes.push(resume)
  }

  function updateResume(id: string, updates: Partial<Resume>) {
    const item = data.value.resumes.find(r => r.id === id)
    if (item) Object.assign(item, updates)
  }

  return {
    data,
    jobs,
    candidates,
    resumes,
    experiences,
    educations,
    matchResults,
    dashboardStats,
    candidateById,
    jobById,
    experiencesByCandidate,
    educationsByCandidate,
    resumesByCandidate,
    matchResultsByJob,
    matchResultsByCandidate,
    addJob,
    updateJob,
    addCandidate,
    updateCandidate,
    addExperience,
    updateExperience,
    deleteExperience,
    addEducation,
    updateEducation,
    deleteEducation,
    addMatchResult,
    updateMatchResult,
    addResume,
    updateResume,
  }
})
