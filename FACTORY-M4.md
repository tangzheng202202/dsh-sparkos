# SparkOS 内容工厂 M4：多平台完整草稿包

M4 把 M3 已批准的选题卡转成可执行的创作任务。批准动作会自动创建 `content.generate-package` 队列任务；agent 领取结构化契约，完成公众号、Telegram、X、小红书四个平台的独立稿件后再提交。

## 为什么不用自由文本直接落盘

创作提交必须包含：

- `factClaims`：每条声明标注为事实、推断或观点；事实必须引用选题卡已有证据 URL；
- `variants`：四个平台分别提供完整内容，不允许只交一个母稿后机械截断；
- `wechat.blocks`：公众号结构化段落，由程序转义并渲染 HTML，模型不能注入任意 HTML；
- `assets`：封面与至少两张正文/轮播配图的提示词、替代文本、比例和投放位置；
- `factBoundary`：把已确认事实和仍待观察部分明确告诉读者。

## 状态流

```text
选题 approved
  → awaiting_generation
  → validation_failed（可修正重交）
  → waiting_approval
  → approved / rejected → v2 awaiting_generation
```

只有结构校验和事实引用校验全部通过时，任务才会生成文件并进入人工审核。驳回和批准都会留在 SQLite `approvals` 与工作流事件中。M4 不包含发布动作。

驳回不会覆盖原稿。系统通过 `draft revise` 或工作台按钮创建 `revision + 1` 的新 package，并记录 `parentPackageId`；旧版文件、审核意见与哈希继续保留。

## 本地产物

默认写入：

```text
$SPARKOS_VAULT_ROOT/drafts/factory/YYYY-MM-DD/<package-id>/
```

每个草稿包包含：

- `wechat.html`、`wechat.md`
- `telegram.md`
- `x-thread.md`
- `xiaohongshu.md`
- `assets.json`：视觉 Worker 的配图任务清单
- `package.json`：完整结构化提交
- `manifest.json`：文件哈希、字节数与生成时间

公众号 HTML 只使用程序内置模板，正文会做 HTML 转义，并通过独立预览端点设置 CSP。

## Agent 调用

```text
sparkos_run {action:"draft", payload:{pending:true}}
sparkos_run {action:"draft", payload:{submitPackage:<DraftSubmission>}}
sparkos_run {action:"draft", payload:{packages:true}}
sparkos_run {action:"draft", payload:{revise:"<rejected-package-id>"}}
```

`pending` 返回来源选题卡、事实、证据、风险、平台和提交契约。agent 应在同一创作回合中完成稿件并调用 `submitPackage`；若返回 `VALIDATION FAIL`，根据逐条错误修正后重新提交。

## M4 边界

- `assets.json` 是完整的视觉生产指令，不代表图片二进制已经生成；
- 不调用平台发布 API；
- 不允许 C/D 级证据绕过 M3 闸门；
- 不把推断自动改写成事实；
- 未经人工批准的草稿不得进入发布队列。
