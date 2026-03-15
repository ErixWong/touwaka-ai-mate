## 变更摘要

实现上下文组织接口与策略模式，支持多种上下文组织方式。

## 主要变更

### 1. 上下文组织接口
- 创建 `IContextOrganizer` 接口定义
- 创建 `ContextResult` 类封装结果
- 创建 `ContextOrganizerFactory` 工厂类

### 2. 策略实现
- `FullContextOrganizer`: 完整上下文策略（原有逻辑）
- `SimpleContextOrganizer`: 简单上下文策略（近期10条消息+5个topic）

### 3. 重构
- `ContextManager` 委托给策略工厂
- 消除重复代码

### 4. 数据库
- 添加 `experts.context_strategy` 字段

### 5. 前端
- 策略选择下拉框
- i18n 翻译

### 6. 工具调用优化
- 存储层：完整保存工具结果（不再截断）
- 上下文层：智能截断（可配置阈值）

### 7. 设计文档
- 工具消息摘要方案（Issue #155）

## 测试

- [x] 代码自审
- [x] 功能测试

Closes #154