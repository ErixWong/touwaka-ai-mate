import type { ChatMessage } from './ChatWindow.vue'

export declare const ASSISTANT_LAYOUT: {
  readonly BUBBLE: 'bubble'
  readonly COMPACT: 'compact'
  readonly HIDDEN: 'hidden'
}

export type AssistantLayout =
  | typeof ASSISTANT_LAYOUT.BUBBLE
  | typeof ASSISTANT_LAYOUT.COMPACT
  | typeof ASSISTANT_LAYOUT.HIDDEN

export declare function resolveAssistantLayout(
  message: ChatMessage | Record<string, unknown> | null | undefined,
  options?: { hasToolCalls?: boolean }
): AssistantLayout
