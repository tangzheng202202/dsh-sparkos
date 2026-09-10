# dsh-sparkos

DeepSeek Harness（DSH）自媒体工作台插件：情报采集 → 情报簇分析 → 可解释排名 → 编辑策划 → 多平台创作 → 视觉生产与人工审核 → 派生交付 → 人工发布台账，全流程状态可恢复、决策可审计，五守卫硬执行。

## 能力总览

### sparkos_run 工具（8 个子命令全部实装，dryRun 全局零写入）

- `brief` 今日简报：读最新 `daily_briefing_*.md` + `daily_data_*.json`；`payload.daily` 走五守卫（`payload.commit=true` 才入库）
- `topics` 选题推荐：当日 must_reads；`payload.editorial=midweek|weekly` 生成周三/周六可审批选题卡
- `draft` 草稿中心：`pending` 待生成契约、`request`/`revise` 建任务与修订、`submitPackage` 提交四平台完整草稿包（contractVersion 2）、`packages` 状态
- `distill` 蒸馏审核：runtime + vault 合并队列与审核状态
- `sources` 信息源注册表 + intel 健康快照（只读）
- `publish` 发布表现聚合（只读）
- `advise` 系统建议（只读，守卫⑤）
- `intel` 情报指挥所：ingest/health、`fusion` 日频融合、`analyze`/`submitCluster` 情报簇、`cardRequests` 补卡清单、`rank` 每日 Top5、`jobs` 任务状态、`dispatch` 下发建议
- 情报层信源（2026-09-10 调整）：`alpha-signal` / `hn`（FeedFuse 快照，按条目展开，**唯一带真实热度的源**）/ `hermes-cn` / `baicaotang`（pending）
  - hermes-cn 闸门 = `categories:['科技创新','财经经济']` **或** `topicsAllow:['人工智能','AI','科技',…]`。去「国际动态」把信噪比 20.6%→33.0%（14 天 160→97 条）；主题门是补漏，实测 14 天仅多救回 5 条
  - `cardRequests`：把「够热（`sourceHeat`≥70）但 0 张知识卡」的主题转成可执行补卡清单（`ops-intel/card-requests-*.json|md`，建议编号如 `obs://056`）。**只出建议，不写星火库**
- **T0 分析队列 + 定时簇分析（P4）**：插件不调 LLM（红线），所以插件只负责**收窄工作量**，分析交给 agent。

  | 时间 | 谁 | 做什么 |
  |---|---|---|
  | 09:30 | 插件（`SPARKOS_INTEL_SCHEDULE=1`） | 融合 → 生成骨架 → 写 `analyze-YYYYMMDD.json`（`pending` 全量 + `t0` 有界） |
  | 10:00 | launchd `com.sparkos.intel-analysis` | 先查 `t0`：为 0 直接跳过（**不唤 agent、不烧 token**）；>0 才唤起 headless agent 分析 t0 |

  - T0 判据（`t0Candidates`）：跨源（`sourceCount≥2`）或 `sourceHeat ≥ 80`，**跨源优先**，上限 8 条；实测把每日 36 簇收窄成 8 条
  - `pending` 的排除规则是「**已分析**」而非「已落盘」：骨架先落盘、`topic` 仍空的中间态必须继续排队，否则一次误写骨架就会让该簇永久跳过分析
  - 安装 / 卸载 / 干跑：`bash launch/install-intel-analysis.sh`、`--uninstall`、`SPARKOS_DRY_RUN=1 bash launch/sparkos-intel-analysis.sh`
  - 日志：`$VAULT/system/intel-analysis.log`、`$VAULT/system/schedule.log`
- 多条目馈送的 eventKey 由条目 URL 内容哈希生成 → 同一新闻跨天/跨波次重放自动去重（实测 3094 条原始条目去重后 1257 条）
- **真实热度模型（P1）**：`FusionItem.heat` = 源注意力信号归一化到 0-100，随 `cluster.sourceHeat` 进入排序。

  | 源 | 热度来源 | 映射 |
  |---|---|---|
  | hn / hackernews | HN points（实测 1~1431，中位 105） | 对数 → 0-100（1→10, 112→67, 544→89, 1162→100） |
  | hn / github | 累计 star（35k~1M）**不是今日热度** | 固定 55（仅「登上 trending」的中等信号） |
  | hermes-cn | **不用 `item.heat`**（实测与 breaking/strong 不相关） | strong+breaking 70 / strong 60 / breaking 45 / 其他 25 |
  | alpha-signal | 无热度字段 | `null`（不提供，而非 0） |

  `cluster.heat` = 成员最高真实热度分档（≥70 high / ≥45 medium），多条同主题与跨源各升一级。
  `ranking` 的 `heatScore` 以 `attention`（= `sourceHeat ?? heat 档位`）占 0.25 权重——**此前该项完全缺失**。
- `dryRun=true`：全部 8 个子命令零写入（不初始化 VAULT、不打开 SQLite、不改任何文件 mtime），只返回"将执行动作 + 参数校验结果"；写调用不再声明并发安全

### 内容工厂里程碑（当前能力）

- **M1 状态底座**：Node 内置 SQLite（schema v7，additive migration）保存任务、租约、重试、情报簇、排名历史、视觉批次与发布台账；原始情报与内容产物保留为 VAULT 文件
- **M2 情报排名**：情报簇提交后自动生成每日 Top 5、上升榜、连续霸榜与可创作候选；评分分项可解释，仅证据等级 A/B 可进入创作
- **M3 编辑策划**：周三 4 日窗 / 周六 7 日窗，识别连续霸榜/加速上升/二次升温/事实反转/结构议题，最多 5 张带证据、核心判断、反方与风险的选题卡；全部须人工批准
- **M4 多平台创作（contractVersion 2）**：批准选题后创建结构化创作任务；agent 提交公众号、Telegram、X、小红书完整稿与配图任务清单，程序硬校验事实引用（factClaims 必须引用选题卡已有 http/https 证据 URL）、平台完整度与 contract v2 槽位（公众号封面/正文图、小红书 1 号首图 + 2+ 轮播），生成安全 HTML/Markdown/统一 manifest（每包 8 个产物文件，SHA/bytes 全量校验）；草稿须人工批准
- **M5A 视觉生产**：为已批准草稿创建幂等视觉批次；agent `claim → image_generate → submit` 回交可靠附件，程序校验附件 SHA、真实像素（从 PNG/JPEG/WebP 实际字节解析并与附件声明、任务规格三方一致）、5MiB/40M 像素上限、MIME 白名单与路径安全；图片不可变落盘
- **M5B 视觉审核**：人工批准/驳回（驳回必须带意见）；受控重试（`visual_retry_requests` 审计 + 幂等键 + 当前 attempt 校验 + 事务级并发保护）；`replace_stub_with_production` 显式目的支持"人工确认把已驳回 stub 测试图替换为真实 Provider 图片"，新提交若仍是 stub 在提交闸门被拒；旧 attempt/图片/approval/event 全保留
- **M6 交付与发布台账**：preview/production 双模式派生交付（preview 无论 provider 一律 testOnly + TEST ONLY 横幅；production 要求全部 real provider + contract v2 完整）；幂等复用前重新校验全部磁盘文件与数据库 SHA；发布记录只落 `publication_intents` 台账（不可被 Worker 领取，`claimNextJob` 显式排除历史 publish job），发布动作永远由人工执行

### 信任闸门（不可绕过）

- **testOnly 闸门**：任一 stub provider 图片 → 批次永远 `visual_approved_test`，production 交付与发布记录创建被拒
- **production 闸门**：文本已批准 + 视觉全批准 + 非 testOnly + contract v2 完整 + 双平台 production 交付存在
- **manual publish 闸门**：`publication_intents` 仅是台账；平台 API 调用为零，发布由人工在对应后台执行
- 五守卫（48h 窗口 / event_id 去重 / 引用卡存在 / 主线存在 / 建议只读）继续硬执行

## 每日交付：推送，而不是页面（2026-09-10 决策）

**SparkOS 靠一条推送交付结论，不靠页面。** 用户已经在 Telegram / DSH 会话里工作，
再维护一个「仪表盘」只会增加一个不去看的界面。

实际推送的样子（286 字，一屏读完，全是结论）：

```
📋 SparkOS 晨会 · 2026-09-10 周四

今天要发
· 20:00 → 公众号 🏭《一鱼多吃》（S1E3）；小红书拆条
⚠️ 系统里没找到对应草稿 —— 这篇要你自己写

雷达捡到 3 条备料
· OpenAI 宣称用 AI 解决 Navier–Stokes 千禧年难题并发布证明
· 陶哲轩警告：AI 正在把数学开放问题当「非可再生资源」开采
· Meta 在美上线个人 AI agent Muse：主打「secure by design」

要动手
· 数据回流 0 条 —— 周报没原料（跑周报）
· 补卡 10 张 —— 够热但 0 张知识卡
```

- 生成器：`src/notify/digest.ts`（纯函数，`buildMorningDigest`），只给结论不给原始材料；
  标题经 `headline()` 去掉「——同日…（快照 09-09 08:01 首采…）」这类机器尾巴
- 投递：`scripts/push-digest.mjs`（零第三方依赖）。凭据取自 telegram-bridge 的 `.env` +
  `sessions.json`，可用 `TELEGRAM_BOT_TOKEN` / `SPARKOS_PUSH_CHAT_ID` / `TELEGRAM_BRIDGE_DIR` 覆盖
- 时间线：07:30 `com.sparkos.daily` 跑内容循环 → 08:00 `com.sparkos.morning-digest` 推送
- **不需要 agent**：摘要是确定性代码算出来的，零 token（与 P4 的簇分析不同）
- 安装 / 卸载 / 干跑：`bash launch/install-morning-digest.sh`、`--uninstall`、
  `bash launch/sparkos-morning-digest.sh --dry-run`
- 日志：`$VAULT/system/morning-digest.log`

判断「今天排期有没有对应草稿」用的是保守口径（排期文案与草稿标题的 token 交集），
匹配不上只能说「**系统里没找到**」——草稿完全可能写在 media-os 里。

## 工作台 UI（详情页，非每日入口）

**SparkOS 只有一个正式工作台。** `/sparkos` 与 `/sparkos/app` 是唯一正式入口，渲染统一模板 `src/server/page.template.html`（M8 起原 V1 与 V2 两套实现已合并为这一份；旧 `page-v2.template.html` 已删除，仅存 Git 历史）。

- `/sparkos/app-v2`：**仅为过渡期兼容别名**，渲染与正式入口完全相同的统一模板，不是第二套实现
- 安全序列化（`< > & U+2028 U+2029` 全转义）、每请求 CSP nonce、页面内嵌 CSRF token；全部 mutation POST 走统一 `apiFetch`（application/json + CSRF 头）

### 简报台（brief 模式，默认）

2026-09-10 重定位：**从「系统的仪表盘」改成「我的晨会面板」**。旧版把 8,000+ 字的引擎日志和 24 篇历史草稿铺满首屏，而每日循环真正产出的草稿（带 hook、角度、引用卡）一条都没渲染。现在首屏只回答三个问题，长文本全部折叠：

| 面板 | 回答什么 | 数据来源 |
|---|---|---|
| 01 今天该发什么 | 排期表里今天要发什么 | `media-os/01-content/30天排期.md`（**只读**） |
| 02 今天可以写什么 | 今日循环产出的 hook 级草稿 + 引用卡 | `daily_data_*.json` 的 `drafts` / `citations` |
| 03 底层必读事件 | 今日判定事件（采纳/忽略写决策账本） | `daily_data_*.json` 的 `must_reads` |
| 04 需要你动手 | 数据回流 / 蒸馏积压 / 待写回 / 补卡 | media-os metrics + VAULT 队列 |
| 05 今天哪条线在升温 | 叙事主线 heating/stable/cooling | `daily_data_*.json` 的 `line_updates` |
| 06 水位 | 情报簇 / 带卡数 / 融合 / 数据回流 | `/sparkos/intel` 汇总 |

- 折叠抽屉：**原始简报全文**、**系统建议（守卫⑤）**、**引擎明细**（历史草稿 / 蒸馏 / 待写回）——正常不需要展开
- 视觉：media-os「New City 13」工程蓝图色板（`#0B2545` / `#E0FBFC` / `#3BF4FB` / `#FFB703`）
- **出口**：「取用这篇」只复制一行可粘贴进 `选题池.md` 的 Markdown（**media-os 对插件永久只读，零写盘**）；发布动作永远由人在平台后台执行
- 简报台与 `mode=full` 的九视图工厂模板并存：后者仍只在显式开启时可达

### 统一工作台受控写端点（仅 mode=full）

工厂模板（`factory.template.html`）承载统一九视图：总览（日报摘要/建议）、情报（Top5/簇/叙事线/时间线搜索/融合/下发/归档）、选题（must_reads 采纳/忽略 + 编辑策划审批）、创作（工厂草稿审批/修订 + 运行时草稿）、审核（收件箱/蒸馏/待写回）、视觉（审核/受控重试）、发布（delivery 台账，**不执行平台发布**）、增长、系统（来源注册表/健康）。

它在只读渲染之外，提供以下受控 POST（全部经服务端安全边界：Content-Type 校验、Origin 同源校验、CSRF token；M7/M8 起原 V1 独有能力已全部并入）：

- `POST /sparkos/editorial/decision` 选题卡人工审批（批准/驳回，驳回必填意见）
- `POST /sparkos/creation/decision` 草稿包人工审批
- `POST /sparkos/creation/revise` 创建不可覆盖修订版
- `POST /sparkos/visual/decision` 批准/驳回图片（驳回必填意见）
- `POST /sparkos/visual/retry` 受控视觉重试（含 `purpose=replace_stub_with_production` + 人工确认）
- `POST /sparkos/mutate` 必读采纳/忽略（kind=topic）与蒸馏候选采纳/驳回（kind=distill，四红线人工执行）
- `POST /sparkos/writeback/remove` 待写回清单人工移除（星火库写入永远人工）
- `POST /sparkos/visual/delivery` 生成 preview/production 交付包
- `POST /sparkos/publish` 创建发布台账记录（仅台账，不自动发布）

兼容与红线：contractVersion 1/2 与 legacy 小红书规则继续兼容（旧 v1 包不可证明小红书完整，不能进入 production 交付）；**不存在自动发布**——`publication_intents` 仅是台账，Worker 永不领取发布任务，平台 API 调用为零，发布永远由人工在对应后台执行。

## 安装（DSH profile）

```jsonc
// ~/.dsh/profiles/web/package.json
{ "dependencies": { "dsh-sparkos": "link:/绝对路径/dsh-sparkos" }, "dsh": { "bundles": ["dsh-sparkos"] } }
```

重启 DSH 宿主后访问 `http://<host>:<port>/sparkos/app`。

**干净环境可独立运行**：仓库自带 `seeds/` 种子数据；首次初始化在运行时资产缺失时自动回退 `seeds/`。`prepare` 脚本自动执行 `npm run build`。

## 运行示例（每日闭环）

```
sparkos_run {action:"intel", payload:{fusion:true}}   # 09:30 自动：融合当日情报
sparkos_run {action:"intel", payload:{analyze:true}}  # 生成情报簇骨架（规则预填）
sparkos_run {action:"intel", payload:{submitCluster:<簇>}}  # agent 分析后校验写回
sparkos_run {action:"intel", payload:{rank:true}}     # 每日 Top 5 / 上升榜 / 连续霸榜
sparkos_run {action:"topics", payload:{editorial:"midweek"}} # 周三：最近4日编辑策划
sparkos_run {action:"draft", payload:{pending:true}}          # 领取结构化创作契约
sparkos_run {action:"draft", payload:{submitPackage:<对象>}} # 提交四平台草稿（contract v2）
sparkos_run {action:"draft", payload:{revise:"<package-id>"}} # 创建不可覆盖修订版
sparkos_run {action:"brief"}    # 今日简报
```

## 路径配置（env，均有默认值）

| env | 默认 | 说明 |
|---|---|---|
| `SPARKOS_VAULT_ROOT` | `~/DeepSeek harness/sparkos` | 插件数据区（决策/intel/守卫账本/产物/交付） |
| `SPARKOS_DB_PATH` | `$SPARKOS_VAULT_ROOT/data/sparkos.db` | 内容工厂 SQLite 状态库（schema v7） |
| `SPARKOS_CONTENTOS_ROOT` | `~/cow/projects/contentos-x` | 每日工作流运行时根（只读） |
| `SPARKOS_MEDIA_OS_ROOT` | `~/DeepSeek harness/media-os` | 编辑侧内容 OS（只读：30 天排期 / metrics.csv / 选题池）。缺失时简报台降级但不报错 |
| `SPARKOS_DAILY_BRIEF_DIR` | `$CONTENTOS_ROOT/daily_brief` | daily_data / daily_briefing / drafts |
| `SPARKOS_KNOWLEDGE_ROOT` | `~/cow/knowledge` | 星火知识库（只读，G3 引用卡校验） |
| `SPARKOS_ALPHA_ARCHIVE` / `SPARKOS_HERMES_ARCHIVE` / `SPARKOS_BAICAOTANG_ARCHIVE` | `~/.openclaw/...` / `~/.hermes/...` / null | intel 三源 archive 目录 |
| `SPARKOS_HN_ARCHIVE` | `$SPARKOS_KNOWLEDGE_ROOT/sources/raw` | FeedFuse/HN 每日快照目录（只取 `tech-ai-*.json`，按条目展开；条目自带真实热度 `score`） |
| `SPARKOS_SCHEDULE` / `SPARKOS_INTEL_SCHEDULE` / `SPARKOS_EDITORIAL_SCHEDULE` | `0` | 定时任务开关（默认全关，均不自动外发） |

其余 env（`SPARKOS_PERF_DIR` / `SPARKOS_RUNTIME_DISTILL_QUEUE` / `SPARKOS_RUNTIME_EVENTS` / `SPARKOS_TIMELINE_DATA`）见 `src/vault.ts`。

## HTTP 端点

**只读**：`GET /sparkos/app`（统一工作台 HTML，正式入口）、`GET /sparkos/app-v2`（同一统一模板的兼容别名）、`GET /sparkos/data`、`GET /sparkos/intel`、`GET /sparkos/creation/artifact`、`GET /sparkos/visual/status`、`GET /sparkos/visual/asset`（图片预览，完整性校验）、`GET /sparkos/visual/deliveries` / `delivery` / `download`、`GET /sparkos/draft`、`GET /sparkos/writeback`、`GET /sparkos/csrf`（签发 CSRF token）

**写（全部走统一安全边界：application/json 强制、Origin/Host 同源校验、CSRF token、结构化 JSON 错误）**：

- `POST /sparkos/intel/tick` 手动一轮 ingest
- `POST /sparkos/editorial/decision` `{cardId,decision,note?}` 选题卡人工闸门
- `POST /sparkos/creation/decision` `{packageId,decision,note?}` 草稿包人工闸门
- `POST /sparkos/creation/revise` `{packageId}` 不可覆盖修订版
- `POST /sparkos/visual/queue` `{packageId}` 创建幂等视觉批次
- `POST /sparkos/visual/decision` `{attemptId,decision,note?}` 视觉人工审核
- `POST /sparkos/visual/retry` 受控重试（M6.2 schema 或 legacy `{taskId}`，同一后端状态机；支持 `purpose`/`humanConfirmation`）
- `POST /sparkos/visual/delivery` `{packageId,mode}` 派生交付
- `POST /sparkos/publish` `{packageId}` 发布台账记录（仅台账）
- `POST /sparkos/mutate` `{kind,id,action}` 决策落 VAULT state/
- `POST /sparkos/writeback/remove` / `POST /sparkos/writeback/clear` 待写回清单维护

## 设计红线

- 星火知识库对插件**只读**；写回仅经蒸馏审核 + 待写回清单人工复制
- 系统建议只读（守卫⑤），任何采纳动作必须人工触发
- intel 不自动外发；发布权/所有权归原 Owner
- 发布台账不可执行：Worker 永不领取发布任务，平台 API 调用为零
- 产物完整性：SQLite SHA/bytes 为唯一权威，磁盘文件永远被重新校验；半写状态由原子写入（tmp+fsync+rename）与可恢复语义消除

详见 [ARCHITECTURE.md](ARCHITECTURE.md)（架构与状态机）与 [SECURITY.md](SECURITY.md)（安全边界）。

## 开发

运行要求：**Node.js ≥ 22.13**（内置 `node:sqlite`）；DOM 检查另需 **Google Chrome**（`/Applications/Google Chrome.app`）与 **Python 3**（`scripts/dom-check.py`）。

```bash
npm ci            # 安装依赖（.npmrc 已配 legacy-peer-deps，干净 clone 直接可用）
npm run check     # tsc 类型检查（默认走已发布 @deepseek-ai 类型包）
npm test          # 全量回归测试（数量随命令输出动态给出，见 # tests 行）
npm run test:dom  # 渲染工作台并跑 Chrome DOM 断言
npm run build     # esbuild host 半 + client 半（模板拷贝进 lib/）
npm audit         # 依赖漏洞审计
```

本机若有 DSH monorepo 源码，可创建 **不提交的** `tsconfig.local.json` 把 `@deepseek-ai/*` 映射到 monorepo 路径（`npm run check` 自动优先使用）：

```jsonc
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "baseUrl": ".",
    "paths": {
      "@deepseek-ai/cordis": ["<monorepo>/vendor/cordis"],
      "@deepseek-ai/dsh-tools": ["<monorepo>/packages/core/tools"],
      "@deepseek-ai/dsh-attachment": ["<monorepo>/packages/attachment/attachment"],
      "@deepseek-ai/dsh-host-webserver": ["<monorepo>/packages/host/webserver"]
    }
  }
}
```

CI（GitHub Actions）见 `.github/workflows/ci.yml`。

## 许可证

待决定（作者未确认，暂不声明任何开源许可证）。
