export async function tick() {
  return { ok: true, skipped: true, reason: 'no_background_work' }
}

export default { tick }
