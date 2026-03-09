## 📋 功能描述

实现系统配置管理功能，将硬编码的静态变量移至设置界面，支持管理员动态配置。

## 🔗 相关链接

- 分析报告 PR: #45
- 详细设计: [`docs/core/tasks/2026-03-08-static-variables-audit/design.md`](../docs/core/tasks/2026-03-08-static-variables-audit/design.md)

## ✅ 实施步骤

### 阶段一：数据库和后端

- [ ] 创建 `system_settings` 表迁移脚本
- [ ] 执行迁移
- [ ] 重新生成 Model
- [ ] 创建 [`SystemSettingController`](server/controllers/system-setting.controller.js)
- [ ] 添加路由 `GET/PUT /api/system-settings`

### 阶段二：前端

- [ ] 创建 [`systemSettings.ts`](frontend/src/stores/systemSettings.ts) Pinia Store
- [ ] 创建 [`SystemConfigTab.vue`](frontend/src/components/settings/SystemConfigTab.vue) 组件
- [ ] 在 [`SettingsView.vue`](frontend/src/views/SettingsView.vue) 中集成新标签
- [ ] 添加国际化文本（中/英）

### 阶段三：集成

- [ ] 修改 [`expert.controller.js`](server/controllers/expert.controller.js) 使用系统默认值
- [ ] 修改 [`stream.controller.js`](server/controllers/stream.controller.js) 使用连接限制配置
- [ ] 修改 [`auth.js`](server/middlewares/auth.js) 使用 Token 配置

## 📊 配置项清单

| 分组 | 配置项 | 默认值 |
|------|--------|--------|
| LLM | context_threshold | 0.70 |
| LLM | temperature | 0.70 |
| LLM | reflective_temperature | 0.30 |
| LLM | top_p | 1.0 |
| LLM | frequency_penalty | 0.0 |
| LLM | presence_penalty | 0.0 |
| LLM | max_tokens | 4096 |
| Connection | max_per_user | 5 |
| Connection | max_per_expert | 100 |
| Token | access_expiry | 15m |
| Token | refresh_expiry | 7d |
| Pagination | default_size | 20 |
| Pagination | max_size | 100 |

## ⚠️ 注意事项

- 仅管理员可修改系统配置
- 需要验证配置值的有效范围
- Token 过期时间格式：`15m`, `1h`, `1d`, `7d` 等
