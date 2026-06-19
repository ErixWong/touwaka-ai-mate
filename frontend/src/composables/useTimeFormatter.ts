export function formatRelativeTime(dateStr: string, t: (key: string, params?: Record<string, unknown>) => string): string {
  const date = new Date(dateStr)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMs / 3600000)
  const diffDays = Math.floor(diffMs / 86400000)

  if (diffMins < 1) return t('chat.timeJustNow') || '刚刚'
  if (diffHours < 1) return t('chat.timeMinutesAgo', { n: diffMins }) || `${diffMins}分钟前`
  if (diffDays < 1) {
    return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
  }
  if (diffDays === 1) {
    return t('chat.timeYesterday') + ' ' + date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
  }
  if (diffDays < 7) {
    return t('chat.timeDaysAgo', { n: diffDays }) || `${diffDays}天前`
  }
  return date.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' }) + ' ' +
         date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
}
