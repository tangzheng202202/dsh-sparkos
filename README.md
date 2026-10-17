# dsh-sparkos

DeepSeek Harness（DSH）上的本机简报台。它读每日简报和当日必读，人点「采纳」之后只记在本地账本里，不自动发到公众号、X 或小红书。

默认打开的是简报台，不是内容工厂。选题审批、草稿包、视觉审核、交付和发布台账默认关闭，对应接口返回 **410**。

## 安装

- `brief` 今日简报：读最新 `daily_briefing_*.md` + `daily_data_*.json`；`payload.daily` 走五守卫（`payload.commit=true` 才入库）
- `topics` 选题推荐：当日 must_reads；`payload.editorial=midweek|weekly` 生成周三/周六可审批选题卡
- `draft` 草稿中心：`pending` 待生成契约、`request`/`revise` 建任务与修订、`submitPackage` 提交四平台完整草稿包（contractVersion 2）、`packages` 状态
- `distill` 蒸馏审核：runtime + vault 合并队列与审核状态
- `sources` 信息源注册表 + intel 健康快照（只读）
- `publish` 发布表现聚合（只读）
- `advise` 系统建议（只读，守卫⑤）
- `intel` 情报指挥所：ingest/health、`fusion` 日频融合、`analyze`/`submitCluster` 情报簇、`cardRequests` 补卡清单、`rank` 每日 Top5、`jobs` 任务状态、`dispatch` 下发建议
- 情报层信源默认不接入（0 个源，健康灯是 pending）。要用某个源，设置对应环境变量；过滤规则在变量设上之后才生效：
  - `SPARKOS_ALPHA_ARCHIVE` → `alpha-signal`（目录内全部 json，48h）
  - `SPARKOS_HN_ARCHIVE` → `hn`（FeedFuse 快照，只取 `tech-ai-*.json`，按条目展开，**唯一带真实热度的源**）
  - `SPARKOS_HERMES_ARCHIVE` → `hermes-cn`（只收 published）。闸门 = `categories:['科技创新','财经经济']` **或** `topicsAllow:['人工智能','AI','科技',…]`。去「国际动态」把信噪比 20.6%→33.0%（14 天 160→97 条）；主题门是补漏，实测 14 天仅多救回 5 条
  - `SPARKOS_BAICAOTANG_ARCHIVE` → `baicaotang`
  - `SPARKOS_INTEL_ARCHIVE_ALL` / `SPARKOS_INTEL_ARCHIVE_PUBLISHED` 可以再接任意目录
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

重启宿主，用启动时打印的登录地址打开，再访问 `/sparkos`。页面请求会带上 dsh 的 cookie；没登录时这些地址返回 401 或 403，不返回本机路径。

npm 上还没有 `dsh-sparkos` 这个包，`dsh plugin add dsh-sparkos` 会失败。仓库里已经提交了 `lib/`，安装不会再跑构建，也不需要打开 pnpm 的 `allowBuilds`。

peer 覆盖 DSH `0.0.1-rc.1`、`0.1.0-rc.6` 和 `0.2.x`（含 `0.2.0-rc.2`，以及目前 npm 上的 `0.2.1` 预发布版）。`0.2.6` 及以后的预发布版如果装不上，是范围还没写到那一档。

## 打开之后

简报台有四块：每日简报、当日必读、运行时草稿、蒸馏队列，外加一份待写回清单。

- 第一次初始化会在数据目录放一份日期为 `2000-01-01` 的示例简报。已经有 `daily_briefing_*.md` 时不会覆盖。
- 点采纳或忽略，只写入插件自己的 `state/`。
- 没配情报归档时，健康灯是「情报源未配置」，不是红灯。配了路径但目录不存在，同样不标红，页面会提示目录不存在。
- 真正去读一个已配置、但目录缺失的归档时，ingest 仍会返回 `source-missing`，避免悄悄当成空成功。

## 工厂接口（默认 410）

下面这些写接口在简报台模式下返回 410，响应里会说明怎么临时打开。当前产品不把它们当可用功能：

`POST /sparkos/editorial/decision`、`/sparkos/creation/decision`、`/sparkos/creation/revise`、`/sparkos/visual/decision`、`/sparkos/visual/retry`、`/sparkos/visual/queue`、`/sparkos/visual/delivery`、`/sparkos/publish`

临时打开工厂页面：设置 `SPARKOS_WORKBENCH_MODE=full`，或在数据目录 `config/workbench_mode.json` 写入 `{"mode":"full"}`，然后重启宿主。工厂页面里的发布仍然只记台账，不调用平台接口。

只读入口一直可用：`GET /sparkos`、`/sparkos/app`、`/sparkos/data`、`/sparkos/intel`、`/sparkos/draft`、`/sparkos/csrf`。

## 数据目录

插件数据放在 `$DSH_HOME/sparkos`。没设 `DSH_HOME` 时就是 `~/.dsh/sparkos`。显式 `SPARKOS_VAULT_ROOT` 优先于 `DSH_HOME`。本机就算已经有别的数据目录，也不会自动改用它。缺目录会自动创建。知识库、每日产物、media-os、情报归档都没有默认的个人路径：不设环境变量时，每日产物落在数据目录里，情报源个数是 0。

`/sparkos/data` 不返回 media-os 的绝对路径。页面只显示「未配置」或「已设置但文件不存在」。

| 环境变量 | 未设置时 | 说明 |
|---|---|---|
| `SPARKOS_VAULT_ROOT` | `$DSH_HOME/sparkos`，再否则 `~/.dsh/sparkos` | 插件数据区（决策/intel/守卫账本/产物/交付） |
| `SPARKOS_DB_PATH` | `$SPARKOS_VAULT_ROOT/data/sparkos.db` | 内容工厂 SQLite 状态库（schema v7） |
| `SPARKOS_CONTENTOS_ROOT` | 不使用外部目录 | 设了之后，每日简报 / 表现 / 蒸馏队列 / 事件账本默认挂在它下面 |
| `SPARKOS_MEDIA_OS_ROOT` | 不读 media-os | 编辑侧内容 OS（只读：30 天排期 / metrics.csv / 选题池）。缺失时简报台降级但不报错 |
| `SPARKOS_DAILY_BRIEF_DIR` | 数据目录下的 `daily_brief` | 若设了 `SPARKOS_CONTENTOS_ROOT` 且没设本变量，则用其 `daily_brief` |
| `SPARKOS_PERF_DIR` | 数据目录下的 `perf` | 同上，可被本变量或 `SPARKOS_CONTENTOS_ROOT` 改走 |
| `SPARKOS_RUNTIME_DISTILL_QUEUE` | 数据目录下的 `obsidian-bridge/distill_queue` | 同上 |
| `SPARKOS_RUNTIME_EVENTS` | 数据目录下的 `archive/events.jsonl` | 同上 |
| `SPARKOS_KNOWLEDGE_ROOT` | 空 | 星火知识库（只读，G3 引用卡校验）。空则视为没有引用卡，不扫描当前目录 |
| `SPARKOS_ALPHA_ARCHIVE` | 不接入 | `alpha-signal` |
| `SPARKOS_HN_ARCHIVE` | 不接入 | FeedFuse/HN 每日快照（只取 `tech-ai-*.json`，按条目展开） |
| `SPARKOS_HERMES_ARCHIVE` | 不接入 | `hermes-cn`（published-only，分类或主题白名单） |
| `SPARKOS_BAICAOTANG_ARCHIVE` | 不接入 | `baicaotang` |
| `SPARKOS_SCHEDULE` / `SPARKOS_INTEL_SCHEDULE` / `SPARKOS_EDITORIAL_SCHEDULE` | `0` | 定时任务开关（默认全关，均不自动外发） |
| `TELEGRAM_BRIDGE_DIR` | 不读桥接目录 | 晨会推送的凭据目录。也可直接设 `TELEGRAM_BOT_TOKEN` 与 `SPARKOS_PUSH_CHAT_ID` |
| `DSH_CLI` | 不唤起 agent | `dsh-cli.sh` 的路径，只给情报簇分析定时任务用 |

晨会推送和情报分析的 launchd 任务不继承当前 shell。安装前先 export 需要的变量，再跑 `bash launch/install-morning-digest.sh` 或 `bash launch/install-intel-analysis.sh`，脚本会把当时的值写进 plist。留空的变量会写成空字符串，不会填个人路径。

`SPARKOS_TIMELINE_DATA` 未设置时是数据目录里的 `config/timeline_cards.json`。

## 截图

图还没放进仓库。准备好之后放到下面两个相对路径，这里就会显示。图片需要能从 GitHub 打开；若要投 awesome-dsh-plugin，`screenshots.json` 也用同样的相对路径。

![简报台：打开 /sparkos 后的每日简报和必读](assets/workbench.png)

![采纳一条必读：只写入本地账本，页面上没有发帖按钮](assets/adopt.gif)

## 开发

```bash
npm ci
npm test
npm run check
npm run test:dom   # 简报台 + 工厂模板各跑一遍 Chrome DOM 断言，需要本机 Chrome
npm run build      # 改了 src/ 之后要重新构建，并把 lib/ 一起提交
```

安装方用的是仓库里的 `lib/`。`prepack` 只在打包发布时构建，git 安装不会跑它。

`npm run test:dom` 先渲染默认简报台，再带 `--factory` 渲染工厂模板。DOM 检查脚本：`python3 scripts/dom-check.py brief|full <html>`。

CI 见 `.github/workflows/ci.yml`。

本机若有 DSH monorepo，可以建一份不提交的 `tsconfig.local.json`，把 `@deepseek-ai/*` 指到源码。`npm run check` 会优先用它。

## 许可证

[MIT](LICENSE)。
