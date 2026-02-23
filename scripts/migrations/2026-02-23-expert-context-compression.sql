-- =============================================
-- 专家上下文压缩配置迁移
-- 日期：2026-02-23
-- 描述：为 experts 表添加上下文压缩阈值字段
-- =============================================

-- 添加 context_threshold 字段
-- 压缩阈值，当 Token 占用 >= 阈值 × context_size 时触发压缩
ALTER TABLE experts 
ADD COLUMN context_threshold DECIMAL(3, 2) DEFAULT 0.70 
COMMENT '上下文压缩阈值，Token >= 阈值 × context_size 时触发压缩';

-- =============================================
-- 验证迁移
-- =============================================
-- 执行以下命令验证字段已添加：
-- DESC experts;
-- 或
-- SHOW COLUMNS FROM experts LIKE 'context_threshold';
