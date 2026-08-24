# SparkOS 架构

> 本文描述 dsh-sparkos 的存储边界、核心状态机与信任模型。运行时业务逻辑以 `src/` 为准。

## 顶层视图

```
DSH 宿主（webServer / tools / attachments 服务）
   │
   ├─ sparkos_run / sparkos_visual_* 工具（agent 调用）
   ├─ /sparkos/* HTTP 端点（工作台 UI）
   │
dsh-sparkos 插件
   │
   ├─ VAULT（文件系统，路径由 SPARKOS_VAULT_ROOT 决定）
   │    ├─ config/          主线、命名、时间线（读写仅经初始化迁移）
   │    ├─ state/           决策、蒸馏审核、待写回清单（原子写 JSON）
   │    ├─ ops-intel/       ingest 快照 / fusion / clusters / dispatch（append-only 倾向）
   │    ├─ drafts/factory/  草稿产物（每包 8 文件，不可变）
   │    ├─ visual/          不可变图片资产（SHA 命名）
   │    ├─ deliveries/      派生交付包（preview/production）
   │    └─ data/sparkos.db  内容工厂 SQLite（schema v7，additive migration）
   │
   └─ 只读外部资产：contentos 每日产物、星火知识库、intel 三源 archive
```

## 存储边界：VAULT / SQLite / attachments

| 存储 | 存什么 | 谁写 | 完整性 |
|---|---|---|---|
| **VAULT 文件** | 内容产物、图片、交付包、可变 JSON 状态 | 插件（staging+rename 原子落盘） | manifest/数据库记录 SHA+bytes；读取时重新校验 |
| **SQLite**（`SPARKOS_DB_PATH`） | 任务状态、选题/草稿/视觉/交付/发布台账、情报簇、排名历史 | 插件（事务 + 条件 UPDATE + changes 检查） | schema migration（v1→v7，additive）；条件 UPDATE 失败不写虚假 event |
| **DSH attachments** | 生图可靠附件的权威字节 | DSH 宿主 | 插件只接 `attachmentId` 引用（sha256:…），回读后校验 SHA/字节/真实像素 |

不变量：

- **SQLite 是产物元数据的唯一权威**：磁盘文件永远按数据库 SHA/bytes 重新校验后才被读取或复用；不一致 → 结构化完整性错误，绝不静默修复或继续预览。
- **VAULT 产物目录不可变**：已存在目录在复用前做全量 8 文件校验（manifest 覆盖、SHA、bytes、无额外/缺失/symlink/越界）。
- **可变 JSON 状态原子写**（`src/storage/atomic.ts`）：同目录 tmp → fsync → rename → 失败清理。
- **外部资产对插件只读**：星火知识库、contentos 运行时、intel archive 永不被写入；写回星火库只能走"待写回清单 + 人工复制"。

## 核心状态机

### draft（草稿包）

```
awaiting_generation ──submitPackage(校验通过)──▶ waiting_approval ──人工──▶ approved / rejected
        │                                            │
        └─submitPackage(校验失败)─▶ validation_failed ─┘ rejected + note ─▶ request revision
                                                                  │
                                                  不可覆盖新修订版（revision+1，父包保留）
```

- 提交校验（contractVersion 2）：factClaims 证据必须引用选题卡已有 http/https URL；四平台完整度；配图槽位。
- 文件落盘与 SQLite 状态具备可恢复语义：仅清理"本次新建且 DB 未提交"的目录；已落库目录永不删除。

### visual（视觉任务）

```
queued ─claim─▶ generating ─submit(附件校验)─▶ waiting_visual_approval ─人工─▶ approved / rejected
  ▲                                              │rejected(带意见)                │
  │                                              ▼                               ▼
  └──────────────── retry ◀────────────────────（受控重试）                批次聚合（approved 计数）
                    │
                    ▼ 新 attempt（attempt_no+1）→ generating → …
```

- 附件校验：SHA、MIME 白名单（PNG/JPEG/WebP）、5MiB、40M 像素、**真实像素三方一致**（字节解析 = 附件 ref 声明 = 任务目标规格；结构校验拒绝伪造头部）。
- 重试统一状态机：HTTP 受控 schema、legacy `{taskId}`、`sparkos_visual_retry` 工具全部进入 `requestVisualRetry`（资格门 + `visual_retry_requests` 审计 + 幂等键 + 事务级并发保护）。
- `replace_stub_with_production`：唯一允许 stub 任务重试的显式目的，必须人工确认；新提交仍是 stub → 提交闸门拒绝。
- 旧 attempt、图片、approval、event 全保留（审计不可变）。

### delivery（派生交付）

```
批次视觉全 approved ─▶ createVisualDelivery(mode)
   ├─ preview：testOnly 恒为 true（无论 provider），HTML 带 TEST ONLY，readyForPublication=false
   └─ production：production 闸门（全 real provider + contract v2 完整）→ testOnly=false
幂等：fingerprint 命中 → 复用前重新校验全部磁盘文件 SHA；损坏 → 完整性错误，不返回成功
```

### manual publish（发布台账）

```
readyForPublication === true ─▶ createPublishTask ─▶ publication_intents（台账行）
                                        │
                                        ▼
                          没有任何可执行任务：claimNextJob 显式排除 kind='publish'
                          （历史 publish workflow job 仅保留审计）
                          发布动作 = 人工在对应平台后台执行
```

## 信任边界

```
不可信：agent 提交的草稿/簇/附件声明、HTTP 请求体、历史脏数据
  │  （全部经程序硬校验：schema、引用、SHA、真实像素、URL 白名单）
可信：SQLite 记录、落盘产物的数据库 SHA、人工在工作台的显式操作
  │
人工闸门（不可绕过）：选题批准 / 草稿批准 / 视觉批准或驳回（带意见）/ 发布执行
```

不可覆盖原则：

1. **旧产物不可变**：attempt、图片、approval、event、已落库草稿目录一经写入永不修改或删除。
2. **修订是新增**：驳回后的修订创建新 revision 行，父包与其产物原样保留。
3. **发布不可自动化**：不存在任何"执行发布"的代码路径；台账只为可追溯。
4. **stub 不可发布**：任一 stub 图片 → testOnly 锁死，production 与发布闸门双拒。
5. **建议只读**（守卫⑤）：系统建议永不直接写回知识库或触发动作。
