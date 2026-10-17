# dsh-sparkos 开源引流计划

作者已同意本计划，代码改动在同一分支。这篇只保留当时的发现。个人目录和内部管道名已从本文删掉，git 历史不改。

目标就两件：陌生人 5 分钟能装上并看到东西；然后拿去换 star、X/公众号曝光，并投 [awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin)。

仓库：https://github.com/tangzheng202202/dsh-sparkos （公开，2026-08-20 创建，52 个提交，已有 `dsh-plugin` topic，没有许可证，npm 上没有这个包，也没有 GitHub Release。）

## 1. 这插件是干什么的

装进 DeepSeek Harness（`dsh`）之后，它是一个本机自媒体工作台。情报进来，整理成简报和选题，人点头之后才写稿、配图、记账；它不替你发到公众号、X 或小红书。

现在打开页面，默认是「简报台」，不是 README 开头写的那条完整工厂流水线。工厂那套要另外打开，不开的话相关接口直接 410。

## 2. 别人装不上 / 跑不起来

下面按「陌生人从 GitHub 点进来」的顺序写。能跑的检查都跑过了。

### 安装说明指的不是公开装法

`README.md:60-67` 只教人去改 `~/.dsh/profiles/web/package.json`，依赖写成 `link:/绝对路径/dsh-sparkos`。对方得先把仓库克隆到自己机器上的某个绝对路径，还得知道 DSH 的 profile 文件怎么写。官方装法是 `dsh plugin --profile web add github:tangzheng202202/dsh-sparkos`（列表 README 里就这么写）。本仓库 README 没出现这条命令。

`npm view dsh-sparkos` 返回 404。`gh release list` 是空的。所以 `dsh plugin add dsh-sparkos`（走 npm）一定会失败。

### peer 范围会把预发布版挡在外面

`package.json:40-45` 里 `@deepseek-ai/cordis` 和 `@deepseek-ai/dsh-tools` 是必选 peer，范围都是 `*`。`dsh-attachment`、`dsh-host-webserver` 才是 optional（`package.json:46-53`）。

用 npm 自带的 semver 核过：`0.0.1-rc.1`、`0.1.0-rc.6` 对 `*` 的结果都是不匹配；`4.0.1` 这种正式版才匹配。本仓库自己的 devDependencies 偏偏就是这些 rc（`package.json:63-76`，例如 `dsh-tools@0.0.1-rc.1`、`dsh-agent@0.1.0-rc.6`）。收录指南写明这种范围会让用户 `npm install` 报 `ERESOLVE`。

`.npmrc:1-3` 的 `legacy-peer-deps=true` 只在别人克隆本仓库跑 `npm ci` 时生效。装进对方的 DSH profile 时，不会带上这个文件。作者这边能装，是因为本仓库的 `.npmrc` 把 peer 冲突按掉了。

这次没有在真实的 `dsh` profile 里跑 `dsh plugin add`（环境里没有宿主）。结论来自 semver 和 npm 对 peer 的常规行为，外加收录指南原文。

另外 `@deepseek-ai/schemastery` 写在 `dependencies`（`package.json:37-39`），源码里没有 import。官方包按指南应放 peer，不要打进 dependencies。

### 入口没进 git，默认数据路径是作者自己的机器

`package.json:10` 的入口是 `lib/index.js`，但 `lib/` 在 `.gitignore:2`。只克隆、不跑安装，目录里没有这个文件。`package.json:59` 的 `prepare` 会 `npm run build`。本机 `npm ci` 时构建成功，产出 `lib/index.js`（约 325KB）、`lib/client.js` 和两份模板。

构建结果顶部就 `import { DatabaseSync } from "node:sqlite"`（构建后的 `lib/index.js` 第 766 行，源码在 `src/storage/database.ts:11`）。`package.json:34-36` 要求 Node ≥ 22.13。比这旧的宿主，插件一加载就挂，不是进了页面才挂。npm 默认不强制 `engines`。

默认路径全是作者本机布局，陌生人家里没有这些目录：

| 位置 | 默认落点 |
|---|---|
| `src/vault.ts:19` | 作者家目录下、名字里带空格的插件数据夹 |
| `src/vault.ts:22-23` | 作者家目录下的知识库和一条时间线数据文件 |
| `src/vault.ts:26-34` | 作者家目录下的外部运行时项目，以及其下每日简报、表现数据、蒸馏队列、事件账本 |
| `src/intel/ingest.ts:44-52` | 作者家目录下的两处情报归档；注释里还留着更早的旧路径。README 写的默认值和代码不一致 |

目录不存在时，ingest 记 `source-missing`（`src/intel/ingest.ts:140-142`），健康灯直接红（`src/intel/health.ts:81`）。`README.md:69` 说「干净环境可独立运行」，种子只覆盖主线名、空事件、空知识卡和一个 example.com RSS（`seeds/`）。每日简报不在种子里，简报仍去读外部运行时目录（`src/daily.ts:4-8`）。

按 README 去配环境变量会配错，因为文档里的默认路径和代码不是同一处。

### 装上了也对不上 README 里的产品

默认模式是 brief（`src/server/mode.ts:17-26`）。页面标题是「SparkOS 简报台」（`src/server/page.template.html:6` 和 `:62`）。工厂模板只在 full 模式用（`src/server/routes.ts:125-127`）。工厂写接口在 brief 下返回 410（`src/server/routes.ts:43-52`）。

`README.md:1-27` 和 GitHub 仓库简介仍把「九视图工厂 / 8 子命令全实装」写成当前能力。对方按 README 的每日闭环去点，会以为坏了。

### 测试结果（2026-10-17，Node v22.14.0）

| 命令 | 结果 |
|---|---|
| `npm ci` | 通过。prepare 构建成功。`npm audit` 0 个漏洞 |
| `npm test` | 通过。244 项，0 失败，约 13 秒 |
| `npm run check` | 通过（tsc） |
| `npm run test:dom` | 失败。渲染出来的是 41610 字节的简报台，断言还在找「SparkOS 统一工作台」「叙事主线」「每日 Top 5」等工厂文案（`scripts/dom-check.py:23-26`） |

main 上最近一次 CI 同样挂在 `test:dom`：https://github.com/tangzheng202202/dsh-sparkos/actions/runs/34370963616 （`npm test` 和 `npm run check` 在那次 CI 里是过的）。

未合并分支 `codex/20260930-brief-mode-gates`（`5951740`）的 CI 是绿的。它改了 DOM 断言，并在 README 里写明默认是简报台。安装命令、peer 范围、个人默认路径它没动。先看这支，能用就合，不要在 main 上把 DOM 断言重写一遍。

`README.md:129` 把 DOM 检查写成必须有 macOS 的 `/Applications/Google Chrome.app`。`scripts/dom-check.py:5-8` 其实会退到 `/usr/bin/google-chrome`。`scripts/dom-check-p1.py:5` 把 Chrome 写死在 Mac 路径，而且没有挂进 npm scripts。

## 3. 改进清单（按优先级）

工时是动手时间，不是排期。

### P0 陌生人 5 分钟能装上并看到一页东西

1. **改 peer 范围。** `package.json:40-45` 的 `*` 改成收录指南里的写法，把当前 rc 和后面的正式版都显式放行（`cordis`、`dsh-tools` 必选）。`schemastery` 从 dependencies 挪走或删掉（源码没用）。为什么：这是别人装进现有 DSH profile 时最可能直接失败的一步。约 3 小时，含在一个真实 web profile 里复现 `dsh plugin add`。
2. **README 安装段改成一条命令。** 删掉 `README.md:62-65` 的 `link:/绝对路径`。写成 `dsh plugin --profile web add github:tangzheng202202/dsh-sparkos`，并写一句：GitHub 来源第一次会因为要跑构建脚本被拦住，按提示打开 allowBuilds 再装一次。为什么：现在的说明只有作者自己的机器走得通。约 1 小时。
3. **给一个不用现场编译的安装包。** 发到 npm，或给 GitHub Release 挂一个不带版本号的 `.tgz`。发之前确认 `npm pack` 里有 `lib/index.js`、两份模板和 `seeds/`。为什么：列表和插件市场对源码安装会多一步构建授权；预构建是 5 分钟路径。约 4 小时。
4. **默认路径改成「没有就为空」，并放一份能看的示例简报。** `src/vault.ts:19-34`、`src/intel/ingest.ts:44-58` 不要再默认指向作者家目录。缺源时健康灯写「未配置」，不要红灯 `source-missing`（`src/intel/health.ts:81`）。`seeds/` 加一份每日简报和两三条必读，打开 `/sparkos` 就有字。为什么：装上后第一眼如果是空页面加红灯，对方会以为没装上。约 4 小时。
5. **让文档和默认界面一致。** 合入 `codex/20260930-brief-mode-gates` 里已经写好的「默认 brief、工厂要 full」说明，并改掉 GitHub 仓库简介里的「8/9-tab」。为什么：对方按现 README 去点工厂按钮，接口是 410。约 2 小时（含看那支分支、解决冲突、确认 `test:dom` 变绿）。
6. **安装前提醒 Node ≥ 22.13。** 写在 README 安装段第一行。加载就会用到 `node:sqlite`（`src/storage/database.ts:11`）。约 1 小时。

做完 1–4，5 分钟路径才成立：一条命令装上，打开 `/sparkos`，看到示例简报，点一次采纳有反馈。

### P1 README 截图和 GIF

仓库里没有 `assets/`，README 没有图片，也没有根目录 `screenshots.json`。市场会从 README 抽图，抽不到就是空白详情页。

- `assets/workbench.png`：简报台首屏，要有示例简报，不要空态。
- `assets/settings-card.png`：DSH 设置页里的 SparkOS 卡片。
- `assets/adopt.gif`：点一次采纳，列表状态变掉。放 README 标题下面。
- 根目录 `screenshots.json` 列这几张的相对路径（1–8 张，放自己仓库，不要第三方图床）。

约 3 小时。录之前 P0 的示例数据得先在，不然截到的是空页面。

### P2 LICENSE

`README.md:159-161` 写着「待决定，暂不声明」。仓库 `licenseInfo` 是空的，没有 LICENSE 文件。

作者定一个 SPDX 标识（MIT 或 Apache-2.0 都常见），加 `LICENSE`，`package.json` 加 `"license"`，README 那两行改成指向它。约 1 小时，主要是做决定。

官方收录清单没有把 LICENSE 写成硬性门槛。不发许可证，别人仍不敢转载和二改，引流页也站不住。

### P3 示例

- `examples/five-minutes.md`：从装插件到打开简报的命令，不出现绝对路径，不依赖作者家目录。
- 一段 `sparkos_run` 的 `dryRun` 示例，用种子数据就能跑，并注明 brief 下哪些 action 会 410。
- README「运行示例」改成先指向这个文件。

约 2 小时。

## 4. awesome-dsh-plugin 收录要求

以 2026-10-17 拉到的原文为准：

- 贡献指南：https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/blob/main/contributing.md
- 列表说明：https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/blob/main/README.md
- 网站：https://awesome-dsh-plugin.com

要求（指南原文，不是转述时加的）：

- `package.json` 里要有 `dsh.bundle`，并配上 `cordis.patch.yml`。只写 `dsh.client` 会被拒。
- 仓库是真代码，不是占位或纯 README。
- 仓库创建满 1 天。指南写明已经没有「至少 10 个提交」这条（见他们的 #4196）。
- 仓库加上 `dsh-plugin` topic。
- 描述只说功能，不写广告词，而且必须和代码一致。夸大是打回的主要原因。
- 分类按实际功能选。选偏了维护者会改，不会因此拒。
- 维护者会读源码。能装上、做的事和那一行字一致，才会留。
- 投稿方式：往 `data/plugins/` 加一个 YAML（一个 PR 最多 3 条）。`description.en` 必填，`zh` 可选。不要手改两个 README。
- 推荐但不是门槛：发 npm；或不发 npm 就在 GitHub Release 挂 `.tgz`，用 `tarball:` 指过去。源码根本装不上时，tarball 才是必需的。
- 截图可选：在自己仓库根放 `screenshots.json`。不要再往对方的 `data/screenshots.json` 加新键。
- 官方 `@deepseek-ai/*` 用 peerDependencies。peer 范围必须带上预发布分支，否则匹配不到 `0.1.0-rc.6` 这类版本。

在已拉取的列表 README 里搜过 `sparkos` / `dsh-sparkos`，没有条目。

本仓库对照：

| 项 | 现状 |
|---|---|
| `dsh.bundle` | 有。`package.json:17-20`，`cordis.patch.yml:1-4` 的形状和指南示例一致。最常见的拒因这里不适用 |
| 真代码 | 有 |
| 仓库年龄 | 2026-08-20 创建，已超过 1 天 |
| topic | 已有 `dsh-plugin` |
| 描述属实 | 还不行。现有 README 和仓库简介把工厂写成默认能力，默认其实是简报台，工厂接口 410 |
| 装得上 | 还不行。见第 2 节。评审看的就是「点开的人装上之后，它做那一行字说的事」 |
| npm / tarball | 都没有。不挡收录，但会挡 5 分钟安装 |
| 截图 | 没有。不挡收录 |
| LICENSE | 指南没把它写成硬性条件 |
| 分类建议 | `workflow`（工作流与自动化）。不要为了曝光去挤 UI |

投之前先做完 P0。描述用一句能核对的话，例如：给 DeepSeek Harness 加一个本机简报台，读每日简报和必读，采纳只记在本地账本里，不自动发到社交平台。不要写「九视图全流程工厂」，除非 full 模式和示例数据已经是默认体验。

## 5. 30–60 秒演示镜头

按做完 P0 之后的样子拍。现在录会看到空简报和红灯，不适合发出去。全程不要出终端报错，不要出作者本机路径。

1. **0–8 秒。** 终端一行：`dsh plugin --profile web add github:tangzheng202202/dsh-sparkos`，停在装完。若还要 allowBuilds，这步不要放进成片，成片用已经装好的状态开场。
2. **8–16 秒。** DSH 设置页，SparkOS 卡片入画，点「打开工作台」。
3. **16–30 秒。** 简报台首屏。示例简报标题和两三条必读要能看清。字幕：本机工作台，不发帖。
4. **30–42 秒。** 点一条必读的采纳。按钮状态变掉。字幕：只写入本地账本。
5. **42–52 秒。** 情报健康区。示例源是「未配置」或绿色，不要 `source-missing` 红灯。
6. **52–60 秒。** 停在页面上「不自动发布 / 发布由人工执行」那句。黑场或停帧。

工厂九视图不要塞进这一条。那是第二条片，等 full 模式有示例稿之后再拍。

## 6. 公开风险检查（只报告）

扫过源码、测试、种子、脚本、workflow、lockfile。没有改任何文件。

没找到：API key、token、私钥、邮箱、手机号、内网 IP、内网域名。`package-lock.json` 的下载地址都是 `registry.npmjs.org`。

下面这些可以公开，但会让陌生人觉得这是作者私人环境，建议在 P0 改默认路径时一起收掉：

- `src/vault.ts:19-34` 和 `src/index.ts:4` 默认指向作者家目录（知识库、时间线、外部运行时项目）
- `src/intel/ingest.ts:44-52` 默认指向作者家目录下的情报归档，注释里还有更早的旧路径
- `README.md:89-94` 把上述路径写进了文档，而且和代码不是同一处
- `src/server/data.ts:247` 红线正则里有两条内部管道的中文名（`src/intel/ingest.ts:38` 注释里也有其中一条）。不是密钥，是作者自己的业务名字。具体名字已从本文删除
- `package.json:7` 仓库地址 `github.com/tangzheng202202/dsh-sparkos`。这是公开仓库地址，不是泄漏
- `tests/visual-retry.test.ts:345`、`tests/v2-retry-ui.test.ts:302` 里的 `/Users/me/pic.png` 是故意写的非法路径样例，不是真人目录

种子数据是示例主线和 `https://example.com/rss`，没有个人内容。
