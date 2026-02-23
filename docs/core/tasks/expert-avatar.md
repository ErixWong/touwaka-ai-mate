# 专家头像功能

> 创建日期：2026-02-23
> 完成日期：2026-02-23
> 状态：✅ 已完成
> 优先级：中

---

## 需求概述

为专家添加头像字段，支持两种尺寸的头像：
- **小头像**：日常使用（专家列表、聊天头部、消息头像等）
- **大头像**：对话框背景装饰（固定位置，模糊效果）

---

## 实现总结

### 数据库变更

| 字段 | 类型 | 用途 |
|------|------|------|
| `avatar_base64` | TEXT | 小头像（约 10-20KB） |
| `avatar_large_base64` | MEDIUMTEXT | 大头像（约 50-100KB） |

**升级脚本：**
```sql
ALTER TABLE experts 
ADD COLUMN avatar_base64 TEXT NULL 
COMMENT '小头像Base64（日常使用）' 
AFTER is_active;

ALTER TABLE experts 
ADD COLUMN avatar_large_base64 MEDIUMTEXT NULL 
COMMENT '大头像Base64（对话框背景）' 
AFTER avatar_base64;
```

### 后端修改

| 文件 | 修改内容 |
|------|---------|
| `models/expert.js` | 添加 avatar_base64, avatar_large_base64 字段 |
| `scripts/init-database.js` | 新安装脚本包含头像字段 |
| `server/controllers/expert.controller.js` | list/get/create/update 均支持头像字段 |

### 前端修改

| 文件 | 修改内容 |
|------|---------|
| `frontend/src/types/index.ts` | Expert 接口添加头像字段 |
| `frontend/src/utils/imageCompress.ts` | **新增** 图片压缩工具 |
| `frontend/src/views/HomeView.vue` | 专家卡片显示小头像 |
| `frontend/src/views/ChatView.vue` | 聊天头部显示小头像，传递大头像给 ChatWindow |
| `frontend/src/views/SettingsView.vue` | 专家编辑表单支持上传图片 |
| `frontend/src/components/ChatWindow.vue` | 消息头像使用专家头像，消息区域背景显示大头像 |
| `frontend/src/i18n/locales/zh-CN.ts` | 添加头像相关翻译 |
| `frontend/src/i18n/locales/en-US.ts` | 添加头像相关翻译 |

---

## 图片压缩配置

| 类型 | 最大尺寸 | 质量 | 大小限制 | 硬限制 |
|------|---------|------|---------|--------|
| 小头像 | 128×128 | 80% | 100KB | 300KB |
| 大头像 | 800×800 | 70% | 500KB | 1500KB |

**特性：**
- 自动调整尺寸和质量
- 智能降质：超限时自动降低质量
- 超过 3 倍限制直接拒绝
- 控制台显示压缩前后对比

---

## 头像显示位置

| 尺寸 | 位置 | 实现文件 |
|------|------|---------|
| 小头像 | 专家列表卡片 | HomeView.vue |
| 小头像 | 聊天头部 | ChatView.vue |
| 小头像 | 消息头像（AI） | ChatWindow.vue |
| 大头像 | 消息区域背景（固定、模糊、半透明） | ChatWindow.vue |

**背景效果：**
- `position: absolute` 固定在消息区域
- `opacity: 0.15` 半透明
- `filter: blur(2px)` 模糊效果
- `bottom: 65px` 避开输入框区域
- 消息滚动时背景不动

---

## 设计决策

### 为什么用 Base64 而非 URL？

| 考量 | Base64 | URL |
|------|--------|-----|
| 实现复杂度 | ✅ 简单，无需文件上传 | ❌ 需要文件服务 |
| 部署依赖 | ✅ 仅数据库 | ❌ 需要静态文件服务 |
| 备份迁移 | ✅ 数据库备份即可 | ❌ 需额外处理文件 |
| 存储开销 | ⚠️ 约 30-60KB/专家 | ✅ 仅存路径 |
| 网络传输 | ⚠️ Base64 膨胀 33% | ✅ 二进制传输 |

**结论：** 头像体积小，Base64 的简化优势大于开销。

---

## 相关文件

- [`models/expert.js`](../../models/expert.js) - 专家模型
- [`frontend/src/utils/imageCompress.ts`](../../frontend/src/utils/imageCompress.ts) - 图片压缩工具
- [`frontend/src/views/HomeView.vue`](../../frontend/src/views/HomeView.vue) - 专家选择页
- [`frontend/src/views/ChatView.vue`](../../frontend/src/views/ChatView.vue) - 聊天页
- [`frontend/src/components/ChatWindow.vue`](../../frontend/src/components/ChatWindow.vue) - 聊天窗口组件
- [`frontend/src/views/SettingsView.vue`](../../frontend/src/views/SettingsView.vue) - 设置页
- [`server/controllers/expert.controller.js`](../../server/controllers/expert.controller.js) - 专家 API
