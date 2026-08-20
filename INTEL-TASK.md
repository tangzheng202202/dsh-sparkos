# SparkOS · intel 模块 + 第 9 tab 任务文档（2026-08-20）

> 状态权威源。新会话从这里恢复，避免重读长上下文。

## 一、用户决策（已拍板，勿再议）

| # | 项 | 决定 |
|---|---|---|
| 1 | dshmarket 上架 | **挂起**（跑一周真实使用再看） |
| 2 | intel 模块实现 | **做**（须先过蓝图 §1 确认关卡） |
| 3 | 定时任务（schedule.ts） | **挂起**（先手动用几周） |
| 4 | 第 9 tab「情报指挥所」 | **做**（与 intel 模块绑定，一起交付） |

## 二、intel 模块执行前置（蓝图 §1 关卡，必须逐条完成）

1. 调查研究：三管道现状已盘（2026-08-20 复核）：
   - Alpha Signal: ~/.openclaw/telegram-newsroom/state/archive/（46 文件，published/unsent-scope-blocked）
   - 华夏舆参+百草堂: ~/.hermes/newsroom-cn/state/archive/（326 文件，d*.published.json 混合）
2. 参考先进同类：subagent e69907a1 后台调研中（FeedFuse/TrendRadar/AI newsroom 对标）
3. 结合本地评估：待 subagent 报告
4. 给出 M0/M1 执行方案：待 subagent 报告后整理
5. **用户确认再动手**：方案交用户（老六）审阅，明确同意后方可写代码

## 三、蓝图要点（执行时必须遵守）

- 五模块：🅰只读接入（健康看板优先）→ 🅱判断融合（日频 fusion）→ 🅲下发建议（preferences.json 可选消费）→ 🅳迁移桩（ownership.yml pending）
- 红线 A：永不写三管道 state/、永不动 bot token/launchd
- 红线 B：ownership 是设计桩，默认 pending
- 红线 C：华夏舆参/百草堂发布权归 Hermes（8/11 规则）不变
- 红线 D：发布裁决归用户/原 Owner
- 失败显式化：每轮调度写 ops-intel/runs/ 日志 + 失败标记（反静默降级）
- 数据全在自己 ops-intel/ 目录（可逆、可回滚、纯旁路）
- 里程碑：M0 健康看板 → M1 融合日报 → M2 下发（本期不做）→ M3 迁移（默认不进）

## 四、sparkos 现状（P2 已预留，勿重复）

- src/intel/types.ts：ChannelKind('sparkos'|'rss'|'intel') + Channel + IntelProvider + IntelItem 接口已定义，**无实现**
- src/schedule.ts：定时任务默认关闭（仅提醒日志）
- src/server/ + src/client/index.js：8-tab 工作台已上线（3080 端口 dom-check PASS）
- 五守卫（48h窗口/event_id去重/引用卡存在/主线存在/建议只读）已在 guards.ts

## 五、交付验收标准（沿用既有习惯）

- tsc 通过 / 守卫双向测试 / DOM 渲染检查（Chrome headless + 关键词断言）
- intel 模块真实宿主验证（只读快照不污染源、健康看板三管道状态可见）
- 第 9 tab 渲染 PASS
- heartbeat 任务：sparkos-intel-module（id Tmt0sevn9）

## 六、关联资产

- 蓝图：/Users/mac/cow/knowledge/analysis/intel-command-blueprint-2026-08-19.md（158 行）
- sparkos 代码：/Users/mac/DeepSeek harness/dsh-sparkos/
- 上一阶段交接：/Users/mac/DeepSeek harness/dsh-sparkos/HANDOFF.md
## 七、调研结论（subagent e69907a1，2026-08-20）

**同类对标可取做法**：
- 健康判定 = staleness（上次成功抓取时间）+ 连续失败次数 两个标量（对标 FreshRSS/Miniflux）
- 融合产物即文件（daily report 为唯一事实源），失败源显式标注「缺席」而非阻塞（对标 TrendRadar）
- run 级状态上报 runs/<ts>.json（与本机三管道自身架构同构）
- 日报每条判断回链 archive eventKey（对标 Folo/LLM 阅读器）

**明确舍弃**：主动网络拉取（红线只读快照）、常驻轮询服务（不新增 launchd，用 schedule.ts）、
推送分发与自动发布（M2 才做，发布权归 Hermes 不动摇）。

**技术选型**：Node/TS 在 dsh-sparkos 内实现（src/intel/ 新增 provider+ingest），不写独立脚本。

**目录布局**：ops-intel/{ingest,fusion,runs,dispatch,ownership.yml}（全部只写自己）

**数据契约**：eventKey=文件名去后缀；source=路径推导；status=后缀映射
（published→ok / unsent-scope-blocked→blocked）；raw=原文件不改写

**验收标准**：ingest 字段映射全通过+幂等；三管道 state/ mtime 100 次 run 不变（只读红线回归）；
run 必产出 runs/*.json 且空目录标 fail 不静默；健康灯阈值 alpha≤48h / hermes≤24h；
融合条目含 eventKey 引用；intelProviders 注册需用户显式确认。

**盘查发现**：archive 文件无频道区分字段（channel_text 是内容文本）；百草堂与华夏舆参同目录混合
（样本 200 个文件未见独立频道标识，None×2）。

## 八、待用户确认决策点（2026-08-20，确认后进入实现）

1. **hermes-cn 源粒度**：华夏舆参/百草堂无法从 archive 字段区分 → 选项 A：M0 合并为一个
   「hermes-cn」健康源（推荐，先跑通）；B：你提供频道 id/规则我再拆。
2. **M1 日频融合时间**：建议早 8 点（晚于 Hermes 夜间发布）；健康阈值 alpha≤48h / hermes≤24h。
3. **告警与快照**：健康异常仅工作台标红（推荐）vs 同时写日志由 agent 主动汇报；
   ingest 快照保留 14 天滚动。
## 九、决策 1/2 盘查结论（2026-08-20 二查，可直接执行）

- **决策 1 已定**：archive 306 个 published 文件，303 个 review_chat_id=-5433394392（同一审核群），
  其余 3 个 None；channel_text 仅两类样式（⚡突发快讯 224 / 🔥重点监测 64 / NONE 18）——是内容分类
  而非频道标识。结论：**archive 里只有华夏舆参一个频道的实际数据，百草堂无独立 archive**
  （launchd 也只有 com.hermes.newsroom-cn.* 四个服务）。→ M0 用单源「hermes-cn」，
  百草堂标记 pending-source（有数据后再拆），无需用户提供规则。
- **决策 2 已定**：M1 日频融合 08:00（依据：Alpha 08:30/17:30、Hermes 09:00/17:00 发布，
  08:00 完整覆盖前一日 17:00 后至当日 08:00 前的发布）；健康阈值 alpha≤48h / hermes-cn≤24h。
- **决策 3 待确认（默认推荐）**：健康异常仅工作台标红 + runs/ 日志留痕；ingest 快照保留 14 天滚动。
  如用户无异议，按此执行。
## 十、开工指令（M0 + M1 实现规格，2026-08-20 用户已确认开工）

实现以下内容，遵循 dsh-sparkos 现有结构（src/server/routes.ts + src/server/data.ts +
src/client/index.js + src/guards.ts + src/schedule.ts + src/index.ts），不引入新依赖。

**M0 · 只读情报接入 + 健康看板 + 第 9 tab「情报指挥所」**
1. src/intel/ingest.ts：
   - 快照源：alpha = ~/.openclaw/telegram-newsroom/state/archive/*.json；
     hermes-cn = ~/.hermes/newsroom-cn/state/archive/*.published.json
   - 输出到 VAULT 的 ops-intel/ingest/：每 run 增量快照 d*.snapshot.json；
     eventKey=文件名去后缀；source 推导（openclaw→alpha-signal，hermes-cn→hermes-cn）；
     status 映射（published→ok / unsent-scope-blocked→blocked / rejected→rejected）；
     raw 字段保留原文件内容（不改写）；幂等（二次 run 同 eventKey 零新增）
2. src/intel/health.ts：健康计算——每源 staleness（最新 published 时间）+ 连续失败次数；
   绿灯 alpha≤48h / hermes-cn≤24h；输出 sources[] + overall 状态
3. src/intel/runs.ts：每轮调度写 ops-intel/runs/run-<ts>.json
   {stage, sources[], ok/fail, error}；源 archive 目录缺失必须标 fail: source-missing（不静默）
4. src/schedule.ts：接线每小时 tick（快照+健康+run 上报）；保持默认关闭由配置控制
5. src/server/routes.ts + data.ts：新增 /sparkos/intel 数据端点（健康状态 + 最近 run + archive 计数）
6. src/client/index.js：新增第 9 tab「情报指挥所」：三源健康灯（alpha-signal/hermes-cn/百草堂待接入）、
   各源 archive 计数 + 最近发布 + 最后 run 状态 + 异常标记；复用现有 tab 渲染范式

**M1 · 日频判断融合**
7. src/intel/fusion.ts：输入当天三源 archive 新稿 + 星火知识库参照（只读，不写星火库）；
   输出 ops-intel/fusion/fusion-YYYYMMDD.md + .json；每条判断必须回链 ≥1 个 eventKey；
   融合执行由 agent 经 sparkos_run 手动/半自动触发（不自动外发任何内容）
8. ops-intel/ 目录初始化：ingest/fusion/runs/dispatch（空+README）+ ownership.yml（migration pending）

**验收标准（必须全部通过）**
- tsc 通过；tests/intel.test.ts：fixtures ingest 字段映射全通过 + 幂等（二次 run 零新增）；
  只读红线回归（三管道 state/ 目录 mtime 在多次 run 后不变）；空 archive 目录 run 标 fail 不静默；
  健康阈值断言（alpha≤48h / hermes-cn≤24h）
- 第 9 tab DOM 渲染检查（Chrome headless + 关键词断言）
- 不修改三管道任何文件；不新增 launchd 项；不动 bot token

**回报格式**（最终消息，≤500 字）：文件清单（新增/修改）、测试结果（tsc/单测/DOM）、
ops-intel 目录是否就绪、未完成事项或阻塞、下一步（宿主重启验证注意事项）。
## 十一、并行实现冲突记录（2026-08-20 09:16）

- 现象：实现 subagent 5c5aaa35 与自动会话 session-b8487301（glm-5.2）并行写同一仓库，
  5c5aaa35 文件被覆盖后已停手（零残留，无损坏）。
- 协调决策：**由 session-b8487301 完成实现**（它已写 ingest/runs/health/fusion/report/tick.ts +
  server/data/routes + schedule + tools/run.ts，风格 defaultIntelConfig/IntelConfig）；
  主会话只做验收（tsc/单测/ops-intel/DOM），不再向仓库写入。
- 待办：b8487301 完成后验收；补 tests/intel.test.ts（若对方未建）；宿主攒批重启验证。
## 十二、验收结果（2026-08-20 09:30，主会话接管收尾）

- 并行会话 b8487301 停在半途（tsc 3 错、无 intel 测试）；主会话接管修复：
  runs.ts 补 rmSync/path import、report.ts 补 countSnapshots → **tsc 通过**
- 对方已交付：ingest/health/runs/fusion/report/tick.ts + server 端点(/sparkos/intel, POST /intel/tick)
  + data.ts intel 注入 + schedule/tools/run 接线 + page.template.html 第 9 tab「情报指挥所」
- 主会话补齐：tests/intel.test.ts（6 项：映射/幂等/只读红线/空源fail/健康阈值/initOpsIntel）
- **全量 18/18 测试通过 + tsc 通过**；ops-intel 初始化由 tick/schedule 自动执行
- 下一步：攒批重启宿主 → 真实 tick 初始化 ops-intel → DOM 检查第 9 tab → git commit
