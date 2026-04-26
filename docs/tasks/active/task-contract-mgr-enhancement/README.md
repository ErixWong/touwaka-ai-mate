# Task: 合同管理 App 增强

## 目标

1. 新建记录表单优化 - 排除可自动提取字段
2. 移除不必要的 status 字段
3. Clock handler 日志增强
4. 附件上传大小限制可配置
5. 文件上传权限修复
6. 预生成 record ID 机制

## 变更清单

### 1. 前端表单优化

| 文件 | 变更 |
|------|------|
| `GenericMiniApp.vue` | 新建模式排除 `ai_extractable` 字段；预生成 record ID；传递 recordId 到子组件 |
| `FieldRenderer.vue` | 新增 `recordId` prop |
| `FileField.vue` | 使用 `recordId` 作为 `source_id` |
| `mini-apps.ts` | 新增 `newID()` API；`createRecord` 支持 `clientRecordId` |

### 2. Manifest 配置

| 文件 | 变更 |
|------|------|
| `contract-mgr/manifest.json` | 移除 `status` 字段；移除 `status` 列 |

### 3. 后端 handler 日志

| 文件 | 变更 |
|------|------|
| `submit-ocr/index.js` | 添加详细日志 |
| `check-ocr-status/index.js` | 添加详细日志 |
| `text-filter/index.js` | 添加详细日志 |
| `llm-extract/index.js` | 添加详细日志 |
| `ocr-service/index.js` | 添加详细日志 |
| `fapiao-extract/index.js` | 添加详细日志 |

### 4. 附件上传大小限制

| 文件 | 变更 |
|------|------|
| `attachment.controller.js` | 从系统设置读取 `max_upload_size` |
| `system-setting.service.js` | 新增 `max_upload_size` 配置项 |
| `SystemConfigTab.vue` | 新增上传大小限制配置控件 |
| `zh-CN.ts` / `en-US.ts` | 新增国际化文案 |

### 5. 文件上传权限

| 文件 | 变更 |
|------|------|
| `attachment.controller.js` | 新增 `mini_app` / `mini_app_file` 权限检查 |
| `mini_app_row.js` | 修复 `_status` 字段映射 |

### 6. 预生成 ID 机制

| 文件 | 变切 |
|------|------|
| `server/index.js` | 新增 `/api/newid` 路由 |
| `mini-app.service.js` | `createRecord` 支持 `clientRecordId` |
| `mini-app.controller.js` | 接收 `clientRecordId` 参数 |

## 状态

- [x] 完成
- [ ] 审计

## 关联

- 设计文档: `docs/design/parse4/README.md`