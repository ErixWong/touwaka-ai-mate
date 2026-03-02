# Python 技能支持

> 创建时间：2026-03-02
> 状态：进行中
> 分支：feature/python-skill-support

---

## 背景

当前 skill-runner 只支持 Node.js 技能（使用 vm 模块）。需要扩展支持 Python 技能执行。

## 方案

两套并行方案，根据环境选择：

| 环境 | Node.js 沙箱 | Python 沙箱 |
|------|-------------|-------------|
| 本地开发 | vm 模块 | subprocess + chdir + 危险函数黑名单 |
| 服务端部署 | OpenSandbox | OpenSandbox |

**默认使用本地方案**

## 实现要点

### Python 本地执行器

1. 使用 `child_process.spawn` 执行 Python 脚本
2. 通过 `cwd` 参数 chdir 到技能目录，限制文件访问范围
3. 通过 Python 包装器禁止危险函数：
   - `os.system`, `os.spawn*`, `os.exec*`
   - `subprocess.*`
   - `eval`, `exec`
   - `open`（写模式，可选）
4. 超时控制（默认 30 秒）
5. 通过 stdin/stdout JSON 通信

### 入口文件检测

扩展 `ALLOWED_SCRIPT_EXTENSIONS` 支持多种入口文件：
- `index.js` → Node.js 执行器
- `index.py` → Python 执行器
- `main.sh` → Shell 执行器（后续）

### 代码修改

主要修改 `lib/skill-runner.js`：
1. 添加 `detectScriptType()` 函数检测脚本类型
2. 添加 `executePythonSkill()` 函数执行 Python 技能
3. 修改 `loadSkill()` 支持多种扩展名
4. 修改 `main()` 根据脚本类型选择执行器

## 验收标准

- [ ] Python 技能可以通过 skill-runner 执行
- [ ] 危险函数被正确禁止
- [ ] 超时控制生效
- [ ] 现有 Node.js 技能不受影响

## 进度

- [x] 创建任务分支 feature/python-skill-support
- [x] 修改 skill-runner.js 支持多语言入口检测
- [x] 实现 Python 执行器（subprocess + chdir + 黑名单）
- [x] 更新设计文档 sandbox-architecture.md
- [x] 测试 Python 技能执行

## 测试结果

测试了三个工具：
- `echo`: 返回消息 ✓
- `add`: 计算加法 ✓
- `get_context`: 获取上下文和 Python 版本 ✓
