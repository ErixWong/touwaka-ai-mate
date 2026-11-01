# 转录持久化回滚演练（#1227 阶段 4）

> 目的：证明 **0.29 迁移期间的存量清洗可以被真回滚**，并且回滚**能被测量门禁抓到**——用测量门禁（三格对账 + 块形状多重集 + parity 分类），**不是**朴素深比对。
> 首次执行：2026-11-02 00:0x–01:0x（UTC+8），执行人：主 agent（不采信任何工单自述，全部现跑）。

---

## 1. 为什么不能在生产库上演练

回滚要**写**。生产库 `touwaka_mate` 上禁止批量写（`assertProjectionApplyAllowed` 也直接拒绝 `--apply` 打生产，见 `lib/llm-kit-adapters/transcript-projection.js:979-993`）。所以演练一律在**克隆库**上做：

```bash
# 1) 建演练库（eric 账号无 CREATE 权限，需 root 建库后授权）
mariadb -u root -e "CREATE DATABASE touwaka_drill_261102; GRANT ALL ON touwaka_drill_261102.* TO 'eric'@'%';"
# 2) 克隆四张表（结构 + 数据）
mariadb-dump --single-transaction --no-create-db touwaka_mate \
  agent_rounds agent_transcript_rounds chat_tool_calls messages > /tmp/drill.sql   # 38,828,633 B
mariadb touwaka_drill_261102 < /tmp/drill.sql
# 3) 所有脚本指向演练库
export DB_HOST=127.0.0.1 DB_PORT=3306 DB_USER=eric DB_PASSWORD=… DB_NAME=touwaka_drill_261102 ALLOW_NON_TEST_DB=1 NODE_ENV=production
```

克隆时点：`2026-11-01 16:48:46`（容器时间），行数 `agent_rounds 184 / agent_transcript_rounds 184 / chat_tool_calls 62 / messages 2671`。

---

## 2. 演练流水与实测结果

| # | 动作 | 期望 | 实测 |
|---|---|---|---|
| ① | 演练库（= 当前生产态副本）采三格快照 `--snapshot` | — | `snap-post.json`（29,343 B） |
| ② | `--gate --baseline snap-post.json` 自比对（sanity） | exit 0 | **`GATE_EXIT=0`**；38 请求（0.23 形态 8 / 老账本 30），三格全等 38，块形状全等 38 |
| ③ | 注入回滚：`canonical-rows.rollback.sql`（C2d，69 行）+ `rollback-reasoning.sql`（#1237-A，9 行） | 现场回到改动前 | **见 §3 缺陷**：首次执行 `rc=1`；加 `--default-character-set=utf8mb4` 重放后 `rc=0`、0 错误 |
| ④ | 回滚态 vs `snap-post` | 必须**红**，且差异类别可归因 | **`GATE_EXIT=3`，23 条全部是 `parity_regression`，`cells_mismatch=0 / shape_regression=0 / legacy_cells_drift=0`** |
| ④b | 回滚态对账 `--fix-is-error --fix-folded --fix-reasoning --dry-run` | 漂移按原样重现 | `folded A=69`、`reasoning A=5 / C=4（C_derived=4 / C_opaque=0）`、`tool_error A=29 / B=11` —— 与 C2d / #1237-A 工单里记录的**改动前计数逐格吻合** |
| ⑤ | 演练库里执行修复（**省略 `--dry-run`** = 生产同款写路径） | exit 0 | `EXIT=0` |
| ⑥ | 修复后再 vs `snap-post` | 必须回到**绿** | **`GATE_EXIT=0`**；38 请求三格全等、块形状全等 |
| ⑦ | 与生产逐表校验和 | 需要**正确比法**（见 §4） | 导出时点之前的行：`agent_transcript_rounds` CRC `1185232975`、`messages` CRC `4219818034`、`agent_rounds` CRC `3518589160` —— **演练库与生产完全相同**，行数也相同（169 / 2671→2667 同子集） |

**结论**：回滚 → 修复的往返是**字节保真**的；门禁**能抓到** canonical 被回滚成污染态（`parity_regression`），且**不产生越界误报**（另三类为 0）。阶段 4 的判据成立。

### 为什么门禁是"红得有意义"

`--gate` 的四类失败各有分工，这次演练正好演示了它们的边界：

- **三格对账 / 块形状**看不见 `is_error` / `folded` 这类**布尔标志位**污染（它们不改变轮数、条数、正文长度与块种类）⇒ 回滚后这两类是 0，**不是**"没差异"，而是"这两把尺子量不到"。
- **parity 分类**（`legacy` vs `new` 深比对）量得到 ⇒ 23 条 `parity_regression` 全在这里。
- 所以**只拿三格/形状当闸门会漏掉 canonical 标志位污染**；只拿深比对当闸门又会把展示面本来不存的 `erix` / `metadata` / 浮点 `duration` / 每条消息 `ts` 信封当成"内容丢失"。**两把尺子都要，且各自只信自己量得到的部分。**

---

## 3. 演练抓出的真缺陷（必须先修，否则回滚会静默不全）

**`SET NAMES utf8mb4` 缺失 ⇒ 回滚静默部分失败。**

- 现象：`mariadb < canonical-rows.rollback.sql` 返回 `rc=1`，`/tmp/e1` 里一条
  `ERROR 1366 (22007): Incorrect string value: '\xF3\x96\xBA\xB8L...' for column …record_json at row 1`。
- 根因（三个事实叠加）：
  1. 表是 `utf8mb4_unicode_ci`（四张表都是）；
  2. **`mariadb` 客户端默认 `character_set_client = utf8mb3`**；
  3. 备份生成的回滚 SQL **头部没有 `SET NAMES utf8mb4`**（`grep -icE "set names|utf8mb4"` = 0）。
     ⇒ 含 4 字节字符（emoji / 二进制体，本例是 PNG 字节）的那行被拒。
- 最危险的地方：**客户端报错后继续执行后面的语句**，所以 69 条 UPDATE 里 68 条成功、1 条被跳过，`updated_at` 也照样变了——**回滚看起来"跑完了"**。本次是 `folded=true` 计数停在 39（应为 69）才暴露的。
- 修法（两条都做）：
  1. **执行侧**：`mariadb --default-character-set=utf8mb4` 重放（本次已验证 `rc=0`、0 错误、`canonical folded=true` 精确回到 **69**）；
  2. **生成侧**：备份脚本在 SQL 头部写 `SET NAMES utf8mb4;`，并在重放后**核对影响行数 == 预期行数**（不是只看 `rc`）。
- 跟踪：备份自动化单（要求"写前整表 dump + 备份可读校验 + 备份失败 ⇒ 零生产写入"，本缺陷并入其判据）。

---

## 4. 比"回滚保真"要用对时间边界，否则会误报

`CHECKSUM TABLE` 直接比生产与演练库会得到**三张表不一致**（`chat_tool_calls` 恰好一致），看着像保真失败。真相是：**演练库是某个时点的克隆，生产在那之后仍在写入**（e2e 真机对话把 `agent_transcript_rounds` 从 184 写到 193）。

正确比法：**只比导出时点之前的行子集**，并逐表算 CRC：

```sql
SELECT BIT_XOR(CRC32(CONCAT_WS('|', id, CAST(record_json AS CHAR))))
FROM agent_transcript_rounds WHERE created_at <= '<克隆时点>';
-- messages 用 (id, COALESCE(reasoning_content,''), CHAR_LENGTH(content)) 组合
```

本次结果：三张表 CRC 与行数**全部相同** ⇒ 往返保真成立。
教训：**任何"和线上比一下"的判断都必须先固定时间边界**，尤其是共享开发机上还有别的会话在产生真实流量时。

---

## 5. 复跑清单（命令）

```bash
node scripts/verify-transcript-read-parity.js --snapshot /tmp/drill/snap-post.json --limit 60
node scripts/verify-transcript-read-parity.js --gate --baseline /tmp/drill/snap-post.json --limit 60        # 期望 0
mariadb --default-character-set=utf8mb4 < /docker/touwaka-backups/1227-c2d-2026-11-01/canonical-rows.rollback.sql
mariadb --default-character-set=utf8mb4 < /docker/touwaka-backups/1237-a-2026-11-01/rollback-reasoning.sql
node scripts/verify-transcript-projection.mjs --limit 40 --fix-is-error --fix-folded --fix-reasoning --dry-run --json   # 期望漂移重现
node scripts/verify-transcript-read-parity.js --gate --baseline /tmp/drill/snap-post.json --limit 60        # 期望 3（抓到回滚）
node scripts/verify-transcript-projection.mjs --limit 40 --fix-is-error --fix-folded --fix-reasoning --json              # 修复（写模式）
node scripts/verify-transcript-read-parity.js --gate --baseline /tmp/drill/snap-post.json --limit 60        # 期望 0（回到对照态）
```

注意：`verify-transcript-read-parity.js` 的 stdout 是报告，**不要接 `| head`**（SIGPIPE 会杀进程，本仓踩过）。

---

## 6. 残留

1. **备份生成侧的 `SET NAMES utf8mb4` 尚未落地**（本次只验证了执行侧绕行有效）。
2. 演练库 `touwaka_drill_261102` 用完应 `DROP DATABASE`（本次保留以便复核，见工单评论）。
3. 上线观测指标（行数/请求、索引字节、append 事务 p95、冲突计数、`erix.persistence_capability_degraded` 噪声）仍未系统采集——见 #1227 收尾项。
