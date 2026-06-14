# Task: 文档平台 syncOcr 枚举爆炸修复

## 目标

修复文档平台在 `syncOcr` 调用 MCP 后解析返回结果时，因日志预览或对象摘要枚举代理对象而触发的 `RangeError: Too many properties to enumerate`。

## 背景

2026-06-14 线上日志显示：

1. `AppClock.callMcp()` 已成功拿到对象结果。
2. 随后 `syncOcr` 抛出 `Too many properties to enumerate`。
3. 该异常与 OCR 结果中可能存在的代理对象 / 大对象 / 不可安全枚举对象高度相关。

结合仓库现状进一步确认：

1. `lib/app-clock.js` 在 `callMcp()` 成功后直接对结果执行 `JSON.stringify(result)` 用于 debug 预览。
2. 同文件内部 `summarizeForLog()` 对对象使用 `Object.keys(value)`，遇到带有自定义 `ownKeys` 陷阱的对象会直接抛错。
3. `scripts/verify-document-ocr-service-offline.js` 已存在同类离线场景，说明 OCR 返回结构中出现“不可安全枚举对象”是已知风险模型。

## 本次修改范围

1. 修复 `lib/app-clock.js` 的安全日志摘要逻辑。
2. 保持业务行为不变，仅避免日志预览阶段把请求打崩。
3. 补充任务留痕文档。

## 实施结果

1. 为 `summarizeForLog()` 增加对象枚举失败保护。
2. 为属性读取增加逐项保护，避免个别 getter / proxy 读取异常中断整次摘要。
3. `callMcp()` 的结果预览改为复用 `serializeTickOutput()`，不再直接裸调 `JSON.stringify(result)`。
4. `DocumentOcrService._runJudge()` 不再通过对象展开把原始 MCP 结果并入返回值，避免 `...mcpResult` 触发代理对象枚举。
5. `DocumentOcrService._runJudge()` 构造 judge prompt 时，改为对 MCP 结果使用安全 JSON 预览，而不是直接 `JSON.stringify(mcpResult)`。
6. `syncTaskStatus()` / `submit()` / `cancelTask()` 的 `metadata` 组装改为通过 `toPlainObject()` 合并，避免直接展开潜在异常对象。
7. `buildToolResultSummary()` 增加总兜底，确保摘要失败时退回到安全可序列化结构。
8. 将 `AppClock` 外层 tick watchdog 正式纳入系统设置，归位到 `app.tick_timeout_ms`，与 `app.clock_interval` 同属 App 调度配置。

## 验证

1. 运行 `node scripts/verify-document-ocr-service-offline.js`，确认 OCR 既有离线验证仍通过。
2. 运行一段针对 `app-clock` 日志摘要的 Node 片段，确认对抛出 `ownKeys` 异常的代理对象不会再抛错。
3. 新增离线验证覆盖“judge 成功但原始 MCP 结果不可枚举”的场景，确认不会在 `_runJudge()` 或后续 metadata 落库前炸掉。

## 结论

本次修复属于最小正确修改，目标是把“日志序列化异常”与“业务结果处理”解耦，并进一步消除 `DocumentOcrService` 内部对原始 MCP 返回对象的危险枚举。最终确认本次线上报错不仅可能来自 `AppClock` 日志预览，也可能来自 `_runJudge()` 的 `JSON.stringify(mcpResult)` 和 `{ ...mcpResult }`。上述路径现已统一改为安全摘要/安全合并。

✌Bazinga！
