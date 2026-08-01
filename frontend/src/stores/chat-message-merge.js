export const compareMessages = (a, b) => {
  const timeDiff = new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  if (timeDiff !== 0) return timeDiff
  return a.id.localeCompare(b.id)
}

export const normalizeStoredMessage = (message) => ({
  ...message,
  status: message.status || 'completed',
})

export const mergeMessageData = (current, incoming) => ({
  ...current,
  ...incoming,
  status: incoming.status || current.status,
  updated_at: incoming.updated_at || current.updated_at,
})

export const mergeMessagesById = (currentMessages, incomingMessages, options = {}) => {
  const byId = new Map()

  if (!options.replace) {
    for (const current of currentMessages) {
      byId.set(current.id, current)
    }
  }

  for (const incoming of incomingMessages) {
    const normalized = normalizeStoredMessage(incoming)
    const current = byId.get(normalized.id)
    byId.set(normalized.id, current ? mergeMessageData(current, normalized) : normalized)
  }

  return Array.from(byId.values()).sort(compareMessages)
}

