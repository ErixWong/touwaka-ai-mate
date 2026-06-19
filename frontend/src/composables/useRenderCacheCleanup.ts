import { useMarkdownFormatter } from './useMarkdownFormatter'
import { useToolDataParser } from './useToolDataParser'

export function clearRenderCaches() {
  useMarkdownFormatter().clearCaches()
  useToolDataParser().clearCaches()
}
