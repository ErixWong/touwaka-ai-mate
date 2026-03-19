/**
 * 邀请码 API 服务
 */

import client from './client';

// 类型定义
export interface InvitationQuota {
  quota: number;
  used: number;
  remaining: number;
}

export interface Invitation {
  id: number;
  code: string;
  maxUses: number;
  usedCount: number;
  remaining: number;
  status: 'active' | 'exhausted' | 'expired' | 'revoked';
  expiresAt: string | null;
  createdAt: string;
}

export interface InvitationUsage {
  userId: string;
  username: string;
  nickname: string;
  usedAt: string;
}

export interface VerifyResult {
  valid: boolean;
  message?: string;
  code?: string;
  remaining?: number;
  expiresAt?: string | null;
}

export interface RegistrationConfig {
  allowSelfRegistration: boolean;
}

// API 函数

/**
 * 获取当前用户的邀请配额
 */
export async function getInvitationQuota(): Promise<InvitationQuota> {
  const response = await client.get('/invitations/quota');
  return response.data.data;
}

/**
 * 创建邀请码
 */
export async function createInvitation(options?: {
  max_uses?: number;
  expires_in_days?: number;
}): Promise<Invitation> {
  const response = await client.post('/invitations', options || {});
  return response.data.data;
}

/**
 * 获取当前用户的邀请码列表
 */
export async function getInvitations(): Promise<{ items: Invitation[]; total: number }> {
  const response = await client.get('/invitations');
  return response.data.data;
}

/**
 * 获取邀请码使用记录
 */
export async function getInvitationUsage(invitationId: number): Promise<{ items: InvitationUsage[]; total: number }> {
  const response = await client.get(`/invitations/${invitationId}/usage`);
  return response.data.data;
}

/**
 * 撤销邀请码
 */
export async function revokeInvitation(invitationId: number): Promise<void> {
  await client.delete(`/invitations/${invitationId}`);
}

/**
 * 验证邀请码（公开接口）
 */
export async function verifyInvitationCode(code: string): Promise<VerifyResult> {
  const response = await client.get(`/invitations/${code}/verify`);
  return response.data.data;
}

/**
 * 获取注册配置（公开接口）
 */
export async function getRegistrationConfig(): Promise<RegistrationConfig> {
  const response = await client.get('/auth/registration-config');
  return response.data.data;
}

/**
 * 用户注册
 */
export async function register(data: {
  username: string;
  email: string;
  password: string;
  invitation_code?: string;
}): Promise<{
  user: {
    id: string;
    username: string;
    email: string;
    nickname: string;
    role: string;
  };
  access_token: string;
  refresh_token: string;
}> {
  const response = await client.post('/auth/register', data);
  return response.data.data;
}

/**
 * 更新用户邀请配额（管理员）
 */
export async function updateUserInvitationQuota(userId: string, quota: number): Promise<void> {
  await client.put(`/users/${userId}/invitation-quota`, { invitation_quota: quota });
}

/**
 * 获取用户邀请统计（管理员）
 */
export async function getUserInvitationStats(userId: string): Promise<{
  userId: string;
  username: string;
  invitationQuota: number;
  usedQuota: number;
  remainingQuota: number;
  activeInvitations: number;
  totalInvitedUsers: number;
}> {
  const response = await client.get(`/users/${userId}/invitation-stats`);
  return response.data.data;
}

export default {
  getInvitationQuota,
  createInvitation,
  getInvitations,
  getInvitationUsage,
  revokeInvitation,
  verifyInvitationCode,
  getRegistrationConfig,
  register,
  updateUserInvitationQuota,
  getUserInvitationStats,
};