# dsh-sparkos

DeepSeek Harness（DSH）自媒体工作台插件：把内容生产 10 步工作流从 prompt 变成代码，五守卫硬执行。

## 能力

- **sparkos_run 工具（8 子命令全部实装）**：
  - `brief` 今日简报：读最新 `daily_briefing_*.md` + `daily_data_*.json` 全文；`payload.daily` 提供整份 daily_data 时走五守卫（`payload.commit=true` 才入库）
  - `topics` 选题推荐：当日 must_reads 按新鲜度排序 + 主线名 + 补充角度；`payload.top=N` 取 Top N
  - `draft` 草稿：列出 runtime（daily_brief/drafts）+ VAULT（drafts）草稿；`payload.get=<文件名>` 读全文
  - `distill` 蒸馏审核：runtime + vault 合并队列 + 审核状态（采纳/驳回在工作台操作）
  - `sources` 信息源：`config/info_sources.json` 注册表（只读）+ intel 健康快照
  - `publish` 发布表现：`perf/*.json` 按平台聚合（篇数/总阅读/平均/最近），缺失降级不阻塞
  - `advise` 系统建议：daily_data.suggestions 只读（守卫⑤ G5）+ 已记录决策
  - `intel` 情报指挥所：ingest/health/run 留痕；`payload.fusion=true` 日频融合；`payload.dispatch=true` 生成下发建议
- **9-tab 工作台 UI**：宿主 webServer 挂载 `/sparkos/app`（今日简报/叙事主线/选题推荐/草稿工作区/蒸馏审核+待写回/信息源/发布表现/系统建议/情报指挥所），`_embeddedDailyData` 注入；
  - 今日简报 tab 渲染真实 `daily_briefing` + `daily_data` 摘要（必读/主线增量/草稿/建议/蒸馏候选）
  - 选题 tab 对 must_reads 直接 adopt/ignore（决策落 VAULT state/）
  - 草稿 tab 可查看全文（`GET /sparkos/draft?file=`，仅白名单目录、防穿越）
  - 蒸馏采纳过四红线后进入**待写回清单**（`state/writeback_queue.json`），一键复制全文 + 逐条移除，写回星火库仍由人工完成
  - 情报指挥所 tab 展示融合事实清单（疑似重复主题 🔁 标记）与下发建议（只读，发布权归原 Owner）
  - **内容循环提醒**：每日 09:30 融合完成后写 `system/daily_cycle.json`，工作台简报 tab 显示「📣 内容循环待跑」；今日 daily_data 产出后自动变「✅ 已产出」
- **数据与代码分离**：VAULT 默认 `~/DeepSeek harness/sparkos/`；每日产物从运行时根（默认 `contentos-x`）只读接入；首次启动幂等迁移并落 MANIFEST
- **内容工厂状态底座（M1）**：Node 内置 SQLite 保存任务状态、Worker 租约/重试、情报簇与排名历史；原始情报和内容产物仍保留为 VAULT 文件
- **情报排名（M2）**：情报簇提交后自动生成每日 Top 5、上升榜、连续霸榜和可创作候选；评分分项可解释，只有证据等级 A/B 可进入创作
- **intel 信源扩展位**：`src/intel/types.ts` Provider 接口 + 注册位（实现须走蓝图确认关卡）；健康灯 pending-source 不计入 overall
- **定时任务**：默认关闭；`SPARKOS_SCHEDULE=1` 每日 brief 提醒；`SPARKOS_INTEL_SCHEDULE=1` 每小时 intel tick + 每日 09:30 融合（不自动外发）

## 安装（DSH profile）

```jsonc
// ~/.dsh/profiles/web/package.json
{ "dependencies": { "dsh-sparkos": "link:/绝对路径/dsh-sparkos" }, "dsh": { "bundles": ["dsh-sparkos"] } }
```

然后重启 DSH 宿主，访问 `http://<host>:<port>/sparkos/app`。

**干净环境可独立运行**：仓库自带 `seeds/` 种子数据（主线/命名/事件账本/知识卡/信息源示例），
首次初始化在运行时资产缺失时自动回退 `seeds/`（`SPARKOS_CONTENTOS_ROOT` 指向真实工作流区时优先用之）。
安装后 `prepare` 脚本自动执行 `npm run build` 生成 `lib/`。

## 运行示例（每日闭环）

```
sparkos_run {action:"intel", payload:{fusion:true}}   # 09:30 自动：融合当日情报（30 条 + 疑似重复提示）
sparkos_run {action:"intel", payload:{analyze:true}}  # 生成情报簇骨架（规则预填）
sparkos_run {action:"intel", payload:{submitCluster:<簇>}}  # agent 分析后校验写回
sparkos_run {action:"intel", payload:{rank:true}}     # 每日 Top 5 / 上升榜 / 连续霸榜
sparkos_run {action:"intel", payload:{jobs:true}}     # SQLite 可恢复任务状态
sparkos_run {action:"brief"}    # 今日简报（daily_briefing + daily_data 摘要）
sparkos_run {action:"topics"}   # 选题推荐（评分=新鲜度×连载×深度）
sparkos_run {action:"draft"}    # 草稿列表 / payload.get 读全文
```

每日自动：launchd `com.sparkos.daily` 07:30 触发 headless 跑 sparkos-daily skill（无外部凭证自动降级知识库驱动）。

## 路径配置（env，均有默认值，默认指向本机运行时）

| env | 默认 | 说明 |
|---|---|---|
| `SPARKOS_VAULT_ROOT` | `~/DeepSeek harness/sparkos` | 插件数据区（决策/intel/守卫账本） |
| `SPARKOS_DB_PATH` | `$SPARKOS_VAULT_ROOT/data/sparkos.db` | 内容工厂 SQLite 状态库 |
| `SPARKOS_CONTENTOS_ROOT` | `~/cow/projects/contentos-x` | 每日工作流运行时根（只读） |
| `SPARKOS_DAILY_BRIEF_DIR` | `$CONTENTOS_ROOT/daily_brief` | daily_data / daily_briefing / drafts |
| `SPARKOS_PERF_DIR` | `$CONTENTOS_ROOT/perf` | 发布表现 JSON |
| `SPARKOS_RUNTIME_DISTILL_QUEUE` | `$CONTENTOS_ROOT/obsidian-bridge/distill_queue` | 蒸馏候选（只读） |
| `SPARKOS_RUNTIME_EVENTS` | `$CONTENTOS_ROOT/archive/events.jsonl` | 运行时事件账本（显示用） |
| `SPARKOS_KNOWLEDGE_ROOT` | `~/cow/knowledge` | 星火知识库（只读，G3 引用卡校验） |
| `SPARKOS_TIMELINE_DATA` | `~/cow/visualization/timeline_data.json` | 时间线卡数据 |
| `SPARKOS_ALPHA_ARCHIVE` / `SPARKOS_HERMES_ARCHIVE` / `SPARKOS_BAICAOTANG_ARCHIVE` | `~/.openclaw/...` / `~/.hermes/...` / null | intel 三源 archive 目录 |

## HTTP 端点

- `GET /sparkos/app` 工作台 HTML（内嵌数据）
- `GET /sparkos/data` 工作台数据 JSON（含每日产物/intel/待写回）
- `GET /sparkos/intel` 情报指挥所数据（只读）
- `POST /sparkos/intel/tick` 手动一轮 ingest（不自动融合）
- `POST /sparkos/mutate` `{kind,id,action:adopt|ignore}` 决策落 VAULT state/
- `GET /sparkos/draft?file=` 草稿全文（防穿越）
- `GET /sparkos/writeback` 待写回清单；`POST /sparkos/writeback/remove {file}` 逐条移除；`POST /sparkos/writeback/clear` 清空

## 设计红线

- 星火知识库对插件**只读**；写回仅经蒸馏审核 + 待写回清单人工复制
- 系统建议只读（守卫⑤），任何采纳动作必须人工触发
- intel 不自动外发；发布权/所有权归原 Owner

## 开发

运行要求：Node.js `>=22.13.0`（M1 使用内置 `node:sqlite`）。

```bash
npm run check   # tsc（tsconfig paths 依赖本地 DSH monorepo 源码，需按环境调整）
npm test        # 守卫/VAULT/数据/intel/daily/HTTP/SQLite/排名 双向测试（46 项，env 隔离 fixture）
npm run test:dom# 渲染 /tmp/sparkos-wb.html 并跑 Chrome DOM 断言
npm run build   # esbuild host 半 + client 半（模板拷贝进 lib/）
```
