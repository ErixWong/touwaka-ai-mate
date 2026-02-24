-- 2026-02-24: 扩展 skills 表的 source_type 字段 ENUM 值
-- 支持: database, filesystem, url, zip, local

ALTER TABLE `skills` 
MODIFY COLUMN `source_type` ENUM('database','filesystem','url','zip','local') 
NULL DEFAULT 'filesystem';
