# dsh-sparkos

DeepSeek Harness（DSH）上的本机简报台。它读每日简报和当日必读，人点「采纳」之后只记在本地账本里，不自动发到公众号、X 或小红书。

默认打开的是简报台，不是内容工厂。选题审批、草稿包、视觉审核、交付和发布台账默认关闭，对应接口返回 **410**。

## 安装

需要 **Node.js ≥ 22.13**（插件用内置 `node:sqlite`）。先装好 DSH，再在要使用的 profile 里加这个插件：

```bash
dsh plugin --profile web add github:tangzheng202202/dsh-sparkos#main
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

插件数据放在 `$DSH_HOME/sparkos`。没设 `DSH_HOME` 时就是 `~/.dsh/sparkos`。缺目录会自动创建。知识库和情报归档没有默认的个人路径。

| 环境变量 | 未设置时 | 说明 |
|---|---|---|
| `DSH_HOME` | `~/.dsh` | DSH 自己的家目录。插件数据在它下面的 `sparkos/` |
| `SPARKOS_VAULT_ROOT` | `$DSH_HOME/sparkos` | 要单独改插件数据目录时再用 |
| `SPARKOS_DB_PATH` | `$SPARKOS_VAULT_ROOT/data/sparkos.db` | SQLite，只在打开工厂状态时用 |
| `SPARKOS_DAILY_BRIEF_DIR` | 数据目录下的 `daily_brief/` | 每日简报和必读 |
| `SPARKOS_CONTENTOS_ROOT` | 不设置 | 可选的外部只读运行时根；设置后，未单独指定的每日目录改到这里 |
| `SPARKOS_KNOWLEDGE_ROOT` | 空 | 可选只读知识库。空着时引用卡校验视为不存在 |
| `SPARKOS_PERF_DIR` | 数据目录下的 `perf/` | 平台表现导出 |
| `SPARKOS_INTEL_ARCHIVE_ALL` | 不接入 | 读取该目录下全部 json |
| `SPARKOS_INTEL_ARCHIVE_PUBLISHED` | 不接入 | 只读取 `*.published.json` |
| `SPARKOS_SCHEDULE` / `SPARKOS_INTEL_SCHEDULE` / `SPARKOS_EDITORIAL_SCHEDULE` | `0` | 定时任务，默认全关，不自动外发 |

其余路径（`SPARKOS_RUNTIME_DISTILL_QUEUE`、`SPARKOS_RUNTIME_EVENTS`、`SPARKOS_TIMELINE_DATA`）见 `src/vault.ts`。

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
