## 实现计划

### Phase 1: 后端 API (预计 2-3 小时)

- [ ] **1.1 系统设置存储**
  - 在 `system_settings` 表中添加 `allowed_node_modules` 和 `allowed_python_packages` 字段
  - 创建迁移脚本 `scripts/migrate-package-whitelist.js`

- [ ] **1.2 包列表 API**
  - 文件: `server/controllers/system.controller.js`
  - 端点: `GET /api/system/packages`
  - 实现:
    - Node.js: 执行 `npm list --json --depth=0` 解析结果
    - Python: 执行 `pip list --format=json` 解析结果

- [ ] **1.3 白名单配置 API**
  - 扩展现有 `GET/PATCH /api/system/settings` 端点
  - 支持读取和更新白名单配置

### Phase 2: 沙箱集成 (预计 2-3 小时)

- [ ] **2.1 Node.js 沙箱改造**
  - 文件: `lib/skill-runner.js`
  - 改造 `MODULE_WHITELIST` 为动态读取系统设置
  - 添加外部模块加载支持（如 `adm-zip`）

- [ ] **2.2 Python 沙箱改造**
  - 文件: `lib/skill-runner.js`
  - 在 Python 沙箱包装器中添加 import 检查
  - 只允许白名单中的包被 import

### Phase 3: 前端界面 (预计 2-3 小时)

- [ ] **3.1 系统设置页面**
  - 添加"包白名单"配置区
  - 多选下拉框选择允许的包

- [ ] **3.2 包列表展示**
  - 展示已安装的 Node.js 和 Python 包
  - 支持搜索和筛选

### Phase 4: 测试与文档 (预计 1-2 小时)

- [ ] **4.1 单元测试**
  - API 端点测试
  - 沙箱白名单测试

- [ ] **4.2 文档更新**
  - 更新 `docs/design/package-whitelist.md`
  - 添加使用说明

---

## 技术要点

### Node.js 包检测
```javascript
// 使用 child_process 执行 npm 命令
const { exec } = require('child_process');
exec('npm list --json --depth=0', (error, stdout) => {
  const packages = JSON.parse(stdout);
  // 返回 { name: version } 格式
});
```

### Python 包检测
```javascript
exec('pip list --format=json', (error, stdout) => {
  const packages = JSON.parse(stdout);
  // 返回 [{ name, version }] 格式
});
```

### 白名单检查 (Python)
```python
# 在沙箱包装器中添加
import sys

class ImportChecker:
    ALLOWED_PACKAGES = set(...)  # 从环境变量读取
    
    def find_module(self, name, path=None):
        if name not in self.ALLOWED_PACKAGES:
            raise ImportError(f"Package '{name}' is not in whitelist")
        return original_find_module(name, path)

sys.meta_path = [ImportChecker()]
```

---

## 风险评估

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| npm/pip 命令执行失败 | API 返回空列表 | 捕获异常，返回友好错误信息 |
| 白名单配置错误 | 技能无法执行 | 提供默认白名单，包含基础模块 |
| Python import 检查绕过 | 安全风险 | 多层检查 + 黑名单双重保护 |
