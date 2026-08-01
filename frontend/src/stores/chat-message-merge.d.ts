import type { Message } from '@/types'

export function compareMessages(
  a: Pick<Message, 'created_at' | 'id'>,
  b: Pick<Message, 'created_at' | 'id'>
): number

export function normalizeStoredMessage(message: Message): Message

export function mergeMessageData(current: Message, incoming: Message): Message

export function mergeMessagesById(
  currentMessages: Message[],
  incomingMessages: Message[],
  options?: { replace?: boolean }
): Message[]

