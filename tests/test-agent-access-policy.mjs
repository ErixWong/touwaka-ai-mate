/**
 * Tests for Agent capability scope and legacy assistant access policy.
 *
 * Usage:
 *   node tests/test-agent-access-policy.mjs
 */

import assert from 'node:assert/strict';
import {
  assertRequestedCapabilitiesAllowed,
  buildDeclaredCapabilityScope,
  intersectCapabilityScopes,
} from '../lib/agent/capability-scope-builder.js';
import {
  canAccessAssistantRequest,
  isAdminSession,
  normalizeAssistantCallPrincipal,
} from '../server/services/assistant/access-policy.js';

function testBuildDeclaredScopeFromExpertDefinition() {
  const scope = buildDeclaredCapabilityScope({
    capability_declarations: {
      skills: [
        { skill_id: 'skill_1', mark: 'search' },
        { skill_id: 'skill_2' },
      ],
      document_retrieval: {
        enabled: true,
      },
    },
  });

  assert.deepEqual(scope.skills, ['search', 'skill_2']);
  assert.deepEqual(scope.tools, ['search', 'skill_2']);
  assert.equal(scope.document_retrieval, true);
  assert.equal(scope.can_use_skills, true);
}

function testBuildDeclaredScopeFromDirectAssistant() {
  const scope = buildDeclaredCapabilityScope({
    capability_declarations: {
      direct_tool: {
        tool_name: 'ocr_analyze',
      },
      can_use_skills: false,
    },
  });

  assert.deepEqual(scope.direct_tools, ['ocr_analyze']);
  assert.deepEqual(scope.tools, ['ocr_analyze']);
  assert.equal(scope.can_use_skills, false);
}

function testCapabilityIntersection() {
  const effective = intersectCapabilityScopes({
    caller_scope: {
      tools: ['search', 'ocr_analyze'],
      skills: ['search'],
      document_retrieval: true,
      can_use_skills: true,
    },
    callee_scope: {
      tools: ['search', 'write_file'],
      skills: ['search'],
      document_retrieval: true,
      can_use_skills: true,
    },
    principal_scope: {
      tools: ['search'],
      skills: ['search'],
      document_retrieval: true,
      can_use_skills: true,
    },
    workspace_scope: {
      tools: ['search'],
      skills: ['search'],
      document_retrieval: false,
      can_use_skills: true,
    },
  });

  assert.deepEqual(effective.tools, ['search']);
  assert.deepEqual(effective.skills, ['search']);
  assert.equal(effective.document_retrieval, false);
  assert.equal(effective.can_use_skills, true);
}

function testRequestedCapabilitiesAreDeniedWhenOutsideIntersection() {
  const effective = intersectCapabilityScopes({
    caller_scope: { tools: ['search'], can_use_skills: true },
    callee_scope: { tools: ['search'], can_use_skills: true },
    principal_scope: { tools: ['search'], can_use_skills: true },
    workspace_scope: { tools: ['search'], can_use_skills: true },
  });

  assertRequestedCapabilitiesAllowed(effective, { tools: ['search'] });
  assert.throws(() => assertRequestedCapabilitiesAllowed(effective, {
    tools: ['write_file'],
  }), /Requested capability denied/);
}

function testAssistantRequestAccessPolicy() {
  assert.equal(isAdminSession({ roles: ['admin'] }), true);
  assert.equal(canAccessAssistantRequest({
    session: { id: 'user_1', roles: ['user'] },
    request: { user_id: 'user_1', expert_id: 'expert_1' },
  }), true);
  assert.equal(canAccessAssistantRequest({
    session: { id: 'user_2', roles: ['user'] },
    request: { user_id: 'user_1', expert_id: 'expert_allowed' },
    accessible_expert_ids: ['expert_allowed'],
  }), true);
  assert.equal(canAccessAssistantRequest({
    session: { id: 'user_2', roles: ['user'] },
    request: { user_id: 'user_1', expert_id: 'expert_denied' },
    accessible_expert_ids: ['expert_allowed'],
  }), false);
}

function testNormalizeAssistantCallPrincipal() {
  const principal = normalizeAssistantCallPrincipal({
    session: {
      userId: 'user_1',
      expertId: 'expert_1',
      roles: ['user'],
    },
    body: {
      workspace: {
        expert_id: 'body_expert',
      },
    },
  });

  assert.deepEqual(principal, {
    principal_user_id: 'user_1',
    caller_agent_id: 'expert_1',
    authenticated: true,
    is_admin: false,
  });
}

function main() {
  testBuildDeclaredScopeFromExpertDefinition();
  testBuildDeclaredScopeFromDirectAssistant();
  testCapabilityIntersection();
  testRequestedCapabilitiesAreDeniedWhenOutsideIntersection();
  testAssistantRequestAccessPolicy();
  testNormalizeAssistantCallPrincipal();

  console.log('Agent access policy tests passed.');
}

main();
