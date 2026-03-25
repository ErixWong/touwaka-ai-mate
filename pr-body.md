## 变更说明

将 `assistants` 表的 `assistant_type` 字段重命名为 `id`，将 `assistant_requests` 表的 `assistant_type` 字段重命名为 `assistant_id`，优化字段命名语义。

### 变更详情

**数据库迁移**
- `assistants.assistant_type` → `assistants.id`（主键）
- `assistant_requests.assistant_type` → `assistant_requests.assistant_id`（外键）

**后端更新**
- `server/services/assistant-manager.js` - 更新所有方法签名和实现
- `server/controllers/assistant.controller.js` - 更新路由参数，保留向后兼容
- `lib/context-manager.js` - 更新助理信息展示

**前端更新**
- `frontend/src/types/index.ts` - 更新接口定义
- `frontend/src/api/services.ts` - 更新 API 服务方法
- `frontend/src/stores/assistant.ts` - 更新 Store 方法
- 相关组件更新

### 向后兼容

控制器层保留了对旧参数名 `assistant_type` 的兼容，前端传入 `assistant_type` 仍可正常工作。

Closes #374