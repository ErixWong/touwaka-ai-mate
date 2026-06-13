import type { BrandingSettings } from '@/stores/systemSettings'

export const DEFAULT_BRANDING_APP_NAME = 'Touwaka Mate'
export const DEFAULT_BRANDING_LOGO_ICON = '🤖'

export function getDisplayableLogoIcon(icon: string | undefined | null, fallback: string = DEFAULT_BRANDING_LOGO_ICON): string {
  if (!icon) return fallback
  const trimmed = icon.trim()
  if (/^https?:\/\//.test(trimmed)) return fallback
  if (trimmed.length > 10) return fallback
  return trimmed
}

export function getBrandingAppName(
  branding: BrandingSettings | undefined | null,
  fallback: string = DEFAULT_BRANDING_APP_NAME
): string {
  return branding?.app_name || fallback
}