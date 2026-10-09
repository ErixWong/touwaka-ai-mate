# erix 消息面升级手册（新表 + canonical 回填 + 读侧 `new`）

> 适用：**任何环境**部署 `#1156` 这一批改动（Stage A 建表 / Stage B 写入侧 / Stage C 读侧开关 / Stage D 默认切 `new`）。
> 本机 dev 实例已按本手册执行完毕（2026-10-09）；`nas` / `standalone` 待执行。
> 结论先行：**四步，全幂等，无回填窗口停机，无双写。** 任何一步可重复跑。

## 0. 这套改动是什么（30 秒）

| 对象 | 角色 |
|---|---|
| `agent_rounds` / `chat_tool_calls` / `messages` | **展示面投影**，照旧写入，未删未改语义 |
| `agent_transcript_rounds` | **引擎面唯一真相**：`record_json` = 整份 RoundRecord 原样。`UNIQUE(dedup_key)`，`(request_id,round_no)` **非唯一**（同轮两行是上游契约要求） |
| `llm_kit_run_checkpoint` | run snapshot 档（`revision` 单 run 单调 CAS），**目前无写入方** |
| `ERIX_TRANSCRIPT_READ_MODE` | 读档开关：`new`（**默认**，读 canonical）/ `legacy`（读展示面拼装） |

## 1. 部署四步（顺序不能颠倒）

```bash
# 通用：非测试库必须显式放行（#1167 的测试库守卫），DB_* 按环境填写
export DB_HOST=... DB_PORT=3306 DB_USER=... DB_PASSWORD=... DB_NAME=...
export ALLOW_NON_TEST_DB=1
```

**Step 1 · 建表（先于任何 agent 运行）**

```bash
node scripts/upgrade-database.js --dry-run --step "#1156 Stage A"   # 预演，必须列出两条 pending
node scripts/upgrade-database.js --step      "#1156 Stage A"        # 应用；再跑一次必须全部 Skipped
```
> **不用手动也成立**：`server/index.js:308-330` 的 boot 顺序是「有表 → `needsUpgrade()` → `upgrade()`」，而 `appendRound` 只在服务起来、跑过 agent 之后才被调用 ⇒ **DDL-before-code 天然满足**。手动执行只是让升级过程可见、可核对。
> 为什么必须在前：Stage B 起 `appendRound` 与 canonical 同事务，**canonical 写不进去就整轮回滚**。

**Step 2 · 回填历史（一次性，可重复）**

```bash
node scripts/backfill-transcript-canonical.js --dry-run     --report temp/backfill-dry.json
node scripts/backfill-transcript-canonical.js --write       --report temp/backfill-write.json
node scripts/backfill-transcript-canonical.js --verify-only --report temp/backfill-verify.json
```
**通过标准**：`--write` 之后 `--verify-only` 的 `totals.rounds_mismatched` 必须 **= 0**；再跑一次 `--write` 的 `rounds_written` 必须 **= 0**（幂等）。
`--dry-run` 首轮报「全部 `<canonical 缺行>`」是**正常的**（还没回填），不是故障。

**Step 3 · 两模式等价复核（只读）**

```bash
node scripts/verify-transcript-read-parity.js --report temp/parity.json
```
**通过标准**：`不一致 = 0`、**exit 0**。exit 3 = 有差异，**是信号不是崩溃**，按 `mismatches[].diff_paths` 逐条判读。

**Step 4 · 重启服务**，让新代码生效（读侧默认已是 `new`）。

## 2. 判读规则（别把 0 差异读成"必然如此"）

- **回填出来的历史轮**：canonical 是用 `assembleRoundRecord()` 造的，而 `legacy` 读路径**共用同一个装配函数** ⇒ 两档相等对这批准是**接近同义反复**。Step 3 的真正价值是证明「**切 `new` 不会让历史数据回退**」。
- **升级之后新写入的轮**：canonical 是**整份原始 record**（不是重导）。这些轮将来出现差异是**允许且预期的**，方向应当是 **`new` 更丰富**；**只有 `new` 比 `legacy` 少内容才算回归**。

## 3. 回滚（三级，都不动数据）

| 级别 | 做法 | 影响 |
|---|---|---|
| 只退读档 | `ERIX_TRANSCRIPT_READ_MODE=legacy` + 重启 | 立刻回到旧读法；canonical 仍在写 |
| 退代码 | git 回退到本批之前 + 重启 | 旧代码只写投影表，**新表不写不影响它** |
| 退数据 | **不需要**。旧表从未停写 | ⚠️ **不要 DROP 新表**——DROP 是独立审批项（`agent_rounds` 现在只是冻结回滚锚） |

## 4. 坑（都用真金白银踩过）

1. **迁移/脚本输出不要接 `head`**：管道提前关闭 → SIGPIPE 杀进程，而新步骤恰在步骤列表**末尾**，会被杀在到达之前（幂等救过一次）。看摘要用 `tail` 或先落文件
2. **非测试库要 `ALLOW_NON_TEST_DB=1`**：`#1167` 的守卫默认拦一切非 `llm_kit_test`，两个脚本都复用它
3. **`--dry-run` 报不一致 ≠ 失败**：回填前的正常状态
4. **新装空库**：`#1179` —— 空库路径只跑 `init-database.js`、**不跑 upgrade**，而 init 里缺 `agent_rounds`/`chat_tool_calls` ⇒ 新装库请**先手动 `node scripts/upgrade-database.js` 补齐**，或等 #1179 修好。本手册的 Step 1 已顺手解决这一点（显式跑 upgrade）
5. **孤儿 tool 行告警**：`transcript_orphan_tool_row` 真出现 = 遗留数据或新缺陷。产生机制有两类，一类由单事务消灭（中途失败/crash），一类由 `appendRound` 的 dedup 竞态 fail-fast 守卫消灭（`ERR_TRANSCRIPT_DEDUP_RACE`，erix 顺序 retry 会自动恢复）

## 5. 验收清单

- [ ] Step 1 第二次跑全 Skipped；`SHOW INDEX`：`uk_atr_dedup_key` 唯一、`idx_atr_request_round` **`NON_UNIQUE=1`**、主键单列 `id`
- [ ] Step 2 `rounds_mismatched = 0`；重复 `--write` 写 0 行
- [ ] Step 3 不一致 0、exit 0
- [ ] Step 4 服务 health 200；跑一轮真实对话后 `agent_transcript_rounds` 有新增行且 `chat_tool_calls.duration_ms > 0`
- [ ] 回退演练过一次（至少退读档那一级）
