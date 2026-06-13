import type { BrandingSettings } from '@/stores/systemSettings'

export function getDisplayableLogoIcon(icon: string | undefined | null): string {
  if (!icon) return ''
  const trimmed = icon.trim()
  if (/^https?:\/\//.test(trimmed)) return ''
  if (trimmed.length > 10) return ''
  return trimmed
}

export function getBrandingAppName(
  branding: BrandingSettings | undefined | null,
  fallback: string
): string {
  return branding?.app_name || fallback
}