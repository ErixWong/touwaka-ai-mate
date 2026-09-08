export function normalizeToolContext(context) {
  return typeof context === 'string' ? context : null;
}
