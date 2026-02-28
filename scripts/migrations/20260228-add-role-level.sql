-- Migration: Add level field to roles table for skill access control
-- Date: 2026-02-28
-- Author: Maria

-- Add level column
ALTER TABLE roles 
ADD COLUMN level ENUM('user', 'power_user', 'admin') 
DEFAULT 'user' 
COMMENT '角色权限等级，用于技能访问控制：user(基础)/power_user(中等)/admin(最高)';

-- Update existing roles with their level values
UPDATE roles SET level = 'admin' WHERE name = 'admin';
UPDATE roles SET level = 'power_user' WHERE name = 'creator';
UPDATE roles SET level = 'user' WHERE name = 'user';

-- Add index for quick lookup
CREATE INDEX idx_level ON roles(level);