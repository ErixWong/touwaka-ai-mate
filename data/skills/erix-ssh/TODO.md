# erix-ssh 驻留程序改造计划

## 目标
将 session_manager.js 改造为符合系统驻留程序设计原则的实现

## 任务清单

- [x] 1. 读取现有代码完整内容
- [x] 2. 改造 session_manager.js 为 stdin 事件驱动模式
  - [ ] 2.1 添加 stdin/stdout JSON Lines 通信协议
  - [ ] 2.2 移除 start/stop/status 命令行参数
  - [ ] 2.3 添加 { type: 'ready' } 就绪信号
  - [ ] 2.4 将日志输出改为 stderr
  - [ ] 2.5 保留核心 SSH 会话管理功能
- [ ] 3. 改造 SKILL.md
  - [ ] 3.1 更新工具定义，精简为 4-5 个核心工具
  - [ ] 3.2 为驻留工具添加 is_resident: 1 标记
- [ ] 4. 验证改造结果

## 设计原则参考
- 参考 remote-llm 的实现模式
- stdin 输入命令，stdout 输出响应
- stderr 用于日志
