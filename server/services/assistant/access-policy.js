/**
 * Legacy Assistant access policy helpers.
 *
 * These helpers are pure and do not change route behavior by themselves. They
 * define the policy that later controller/service wiring should enforce.
 */

function getSessionUserId(session = {}) {
  return session.id || session.userId || null;
}

function getSessionRoles(session = {}) {
  return Array.isArray(session.roles) ? session.roles : [];
}

export function isAdminSession(session = {}) {
  return session.isAdmin === true || getSessionRoles(session).includes('admin');
}

export function canAccessAssistantRequest({
  session,
  request,
  accessible_expert_ids = [],
} = {}) {
  if (!session || !request) {
    return false;
  }
  if (isAdminSession(session)) {
    return true;
  }

  const userId = getSessionUserId(session);
  if (userId && request.user_id && request.user_id === userId) {
    return true;
  }

  if (request.expert_id && accessible_expert_ids.includes(request.expert_id)) {
    return true;
  }

  return false;
}

export function assertAssistantRequestAccess(input = {}) {
  if (!canAccessAssistantRequest(input)) {
    throw new Error('assistant_request_access_denied');
  }
}

export function normalizeAssistantCallPrincipal({ session, body = {} } = {}) {
  const userId = getSessionUserId(session);
  const expertId = session?.expertId || body.workspace?.expert_id || null;

  return Object.freeze({
    principal_user_id: userId,
    caller_agent_id: expertId,
    authenticated: Boolean(userId),
    is_admin: isAdminSession(session),
  });
}

export default {
  assertAssistantRequestAccess,
  canAccessAssistantRequest,
  isAdminSession,
  normalizeAssistantCallPrincipal,
};
