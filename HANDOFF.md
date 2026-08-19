# SparkOS 插件 · 会话交接文档（2026-08-19 晚）

> 新会话从这里恢复上下文。本文档是唯一权威状态源。

## 一、项目定案（用户已确认，勿再议）

**目标**：fork star23/content-os → 解构 → 重构为 **DSH 插件 `dsh-sparkos`**（自媒体工作台）。
- fork 已完成：`/Users/mac/cow/content-os-fork`（origin 已指向 github.com/tangzheng202202/content-os）
- 源码已通读：SKILL.md 675 行（10 步 prompt 工作流）+ dashboard.html 2061 行（9 tab 单文件看板）+ config 三件套
- 解构结论：ContentOS = agent 指令 + 数据契约 + 看板，**没有引擎**；重构核心 = 把 10 步从 prompt 变成代码（engine/），守卫硬执行

**用户已拍板的 4 个决定**：
1. 形态 = A：DSH 插件（参照 `/Users/mac/DeepSeek harness/dsh-image-studio` 结构：package.json + cordis.patch.yml + src/tools + src/client + dsh.bundle 配置）
2. 工作台 8 tab（ContentOS 9 tab 裁剪）：今日简报 / 叙事主线(新) / 选题推荐 / 草稿工作区 / 知识卡(新,含蒸馏审核) / 信息源 / 发布表现(合并发布节奏) / 系统建议；砍掉「仓位快照」。后期第 9 tab「🔭 情报指挥所」
3. 信源首版 = RSS + 星火库增量；intel 蓝图（/Users/mac/cow/knowledge/analysis/intel-command-blueprint-2026-08-19.md 已通读）**合并为本插件的一个模块**：架构上预留信源 Provider 接口 channels 类型，实现延后且届时须走蓝图 §1 的确认关卡；ops-intel/ 目录、ownership.yml 桩、四条红线原样保留
4. VAULT = `~/DeepSeek harness/sparkos/`（数据）；插件代码在 `~/DeepSeek harness/dsh-sparkos/`（git 仓库）。数据与代码分离

## 二、下一步（被打断的任务）

**产出 P0/P1/P2 工程拆解 + 每项验收标准，经用户过目后才写代码**（用户刚确认完方案 v2，正要我出拆解时因 token 问题中断）。

拆解要点（已定）：
- P0 = 插件骨架跑通：Cordis 定义 + 1 个工具(sparkos_run) + VAULT 初始化迁移 + 守卫引擎移植（五守卫：48h窗口/event_id去重含当日合并/引用卡存在性/主线存在/建议只读——逻辑已在 /Users/mac/cow/projects/contentos-x/scripts/validate_daily.py 全部验证过，含 --recheck 与防重复 commit 两个实测修复）
- P1 = 工作台 UI：8 tab，数据注入范式照 content-os dashboard（_embeddedDailyData 注入 + tab 切换 + adopt/ignore 交互）；主线/时间线 tab 复用已验证的 /Users/mac/cow/websites/spark-timeline.html（72 卡×10 主线，Chrome DOM 验证过）
- P2 = intel 模块预留 + 定时任务 + 上架 dshmarket 准备
- 每阶段验收须含：tsc 通过 / 守卫双向测试 / DOM 渲染检查（本会话已建立这套验证习惯）

## 三、可复用资产（全部已验证）

- 守卫引擎：contentos-x/scripts/validate_daily.py（五守卫+--recheck+防重复commit）
- 主线聚类：contentos-x/obsidian-bridge/cluster_lines.py + scripts/build_timeline.py（关键坑：观察/模型编号 1-21 撞号，必须用 (kind,num) 复合键；标签传播会塌缩，用溯源划分=1跳hub优先+并列取最早）
- 时间线 UI：/Users/mac/cow/websites/spark-timeline.html（content-os 设计范式 + 星火色板 #FFF8EF/#E8563D/#F5A95C）
- 数据资产：contentos-x/config/narrative_lines.json(10主线)+line_names.json+archive/events.jsonl(7事件)+profile 双层
- 星火库对插件只读；写回仅经 distill_queue 人工审核

## 四、环境速查

- DSH 插件参照：~/DeepSeek harness/dsh-image-studio（package.json 的 dsh.bundle 段 + cordis.patch.yml + src/tools 模式）
- 星火知识库：/Users/mac/cow/knowledge（index.md 头部🔥段为增量入口）；timeline 数据：/Users/mac/cow/visualization/timeline_data.json
- media-os 资产（草稿模板/人设）：~/DeepSeek harness/media-os（VAULT 同区，草稿生成直接复用）
- 验证工具链：Chrome headless --dump-dom + 关键词断言（含"应消失项必须消失"）

## 五、历史结论（一句话级别）

早期曾误解目标做了"脚本+简报"版（contentos-x/，留作参考实现不删）；用户纠正后定案插件工作台形态。旧时间线方案未否定，已补做交付。goal 轮次机制空转 256 轮是本会话 token 浪费主因。
