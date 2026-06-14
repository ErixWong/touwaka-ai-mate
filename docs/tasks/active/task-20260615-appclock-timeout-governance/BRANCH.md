# Branch Mapping

- Task: `task-20260615-appclock-timeout-governance`
- Current branch: `fix/20260615-appclock-timeout-governance`
- Scope: AppClock tick timeout 治理、人工介入机制、前端运行态管理
- Status: active (implementation done, pending manual test)

## 修改文件

### 后端
1. `lib/app-clock.js` — 核心改动：
   - 新增 `timedOutApps` Set、`runStatus` Map
   - `invokeTick()` 区分 timeout 与普通失败，timeout 后不释放 `runningApps`，进入 `timed_out` 状态
   - tick promise 延迟 resolve/reject 追踪，确保 `runningApps` 最终释放
   - `wakeNext()` 检查 `timedOutApps` 跳过已超时 app
   - 新增 `getRunStatus()` / `clearTimedOut()` / `forceTick()` 公开方法
2. `server/routes/app-clock.routes.js` — 新增 API：
   - `GET /api/app-clock/status` — 所有 app 运行状态
   - `GET /api/app-clock/status/:appId` — 单个 app 状态
   - `POST /api/app-clock/clear/:appId` — 清除 timed_out 恢复调度
   - `POST /api/app-clock/force-tick/:appId` — 手动触发 tick
3. `server/index.js` — 注册 app-clock 路由

### 前端
1. `frontend/src/components/settings/AppClockStatusTab.vue` — 管理员运行状态面板
2. `frontend/src/views/SettingsView.vue` — 新增菜单项与渲染入口
3. `frontend/src/router/index.ts` — 新增 `/system/app-clock` 路由

## 说明

1. 本任务聚焦 AppClock 平台层调度语义，不假定 app 内部业务对象类型。
2. 本任务不要求平台理解 document/note/email 等业务 work unit，只要求正确管理 app 级 tick 运行态。
3. 本任务适合作为后续外包发包或内部迭代的统一起点文档。

✌Bazinga！
