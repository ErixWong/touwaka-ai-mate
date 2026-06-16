# Skill Runner Relative Path Fix

## 目标

- 修复 Node 技能沙箱中相对路径错误按宿主进程 cwd 解析的问题。
- 确保 `fs` 技能和其他依赖受限 `fs` 的 Node 技能按工作目录读写文件。

## 范围

- `lib/skill-runner.js`
- `data/skills/fs/index.js`
- `tests/test-sandbox-fs-restriction.js`

## 问题现象

- 技能传入相对路径如 `奇瑞标准对比分析报告.md` 时，被受限 `fs` 解析到宿主容器目录 `/app/...`。
- 沙箱允许路径实际是用户工作目录，如 `/data/work/<workspace>/<task>`。
- 最终导致合法相对路径被误判为越权访问。

## 根因

- `skill-runner` 已计算出 `effectiveCwd` 作为沙箱工作目录和允许目录。
- 但受限 `fs` 在校验路径时使用 `path.resolve(filePath)`，相对路径会基于宿主进程 cwd 解析，而不是 `effectiveCwd`。

## 修复方案

- 给受限 `fs` 和 `fs.promises` 的路径检查增加 `baseCwd`。
- 相对路径统一使用 `path.resolve(baseCwd, relativePath)`。
- 保持现有白名单校验不变。

## 验证

- 补充并运行沙箱路径限制回归测试。
- 验证相对路径、子目录相对路径、越权路径、`fs.promises` 行为一致性。

## 结果

- 已修复 Node 技能沙箱相对路径解析错误。
- 受限 `fs` 与 `fs.promises` 现在都会先把相对路径解析到 `effectiveCwd`，再执行白名单校验与实际文件操作。
- `fs` 技能注释已同步修正，避免将 VM 的伪 `process.cwd()` 与宿主 `fs` 代理行为混淆。

## 验证结果

- `node tests/test-sandbox-fs-restriction.js` 通过（10/10）
- `node tests/test-skill-runner-relative-path.js` 通过（7/7）
- `node --check lib/skill-runner.js` 通过

## 额外补强

- 已补充真实 `skill-runner` 级别的 `fs.promises` 端到端测试。
- 已覆盖双路径参数 `rename(from, to)` 场景。
- 已覆盖 `file://` URL 形式路径在允许目录内的执行场景。

## 新增改进

- 已为 Node.js / Python 技能执行失败补充脚本修复建议输出。
- 失败返回现在会附带当前脚本类型的编写要求，以及按错误模式匹配的修复提示。
- 已补充 `tests/test-skill-runner-error-guidance.js` 验证提示文本会随失败结果一起返回。
- 当依赖或模块不在白名单中时，提示会明确引导 LLM 向管理员申请将其加入白名单。
