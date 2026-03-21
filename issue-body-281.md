## 背景

当前数据库中存在 9 个 `tinyint(1)` 类型的布尔字段，需要统一改为 `bit(1)` 类型以保持数据库字段类型的一致性。

## 当前 tinyint 字段列表

| 表名 | 字段名 | 当前类型 | 说明 |
|------|--------|----------|------|
| ai_models | supports_reasoning | tinyint(1) | 是否支持思考/推理模式 |
| expert_skills | is_enabled | tinyint(1) | 是否启用 |
| kb_paragraphs | is_knowledge_point | tinyint(1) | 是否是知识点 |
| knowledge_bases | is_public | tinyint(1) | 预留，暂不使用 |
| positions | is_manager | tinyint(1) | 是否为负责人职位 |
| skills | disable_model_invocation | tinyint(1) | 禁用模型调用 |
| skills | user_invocable | tinyint(1) | 用户可调用 |
| skill_parameters | is_secret | tinyint(1) | 是否敏感参数 |
| solutions | is_active | tinyint(1) | 是否启用 |

## 任务

1. 在 `scripts/upgrade-database.js` 中添加迁移脚本，将上述 9 个字段从 `tinyint(1)` 改为 `bit(1)`
2. 运行迁移脚本验证
3. 重新生成模型文件

## 注意事项

- 迁移脚本需要幂等性（可重复执行）
- 需要保留现有数据
- 迁移后需要重新生成 Sequelize 模型