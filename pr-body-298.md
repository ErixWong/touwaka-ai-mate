## 变更概述

精简 Office 技能工具数量，删除 Python 实现，统一使用纯 Node.js。

## 变更详情

### xlsx 技能
- **20 工具 → 7 工具**
- 新工具：`excel_read`, `excel_write`, `excel_sheet`, `excel_format`, `excel_query`, `excel_convert`, `excel_calc`
- 通过 `scope`/`action` 参数区分不同操作

### pptx 技能
- **14 工具 → 6 工具**
- 新工具：`pptx_read`, `pptx_write`, `pptx_slide`, `pptx_image`, `pptx_table`, `pptx_export`

### docx 技能
- **14 工具 → 5 工具**
- 新工具：`docx_read`, `docx_write`, `docx_edit`, `docx_convert`, `docx_image`

### chart 技能
- 重命名为 `echarts-chart`
- 3 工具：`echarts_generate`, `echarts_raw`, `echarts_types`

### 清理
- 删除所有 Python 脚本（`scripts/` 目录）
- 删除 XSD schemas 文件
- 删除 `__pycache__` 缓存
- 删除 LICENSE.txt（统一使用项目许可证）

## 统计

| 指标 | 数值 |
|------|------|
| 删除文件 | 189 个 |
| 新增代码 | 2,457 行 |
| 删除代码 | 73,406 行 |
| 工具数量 | 51 → 21 (减少 59%) |

Closes #298