# dsh-sparkos

DeepSeek Harness（DSH）自媒体工作台插件：把内容生产 10 步工作流从 prompt 变成代码，五守卫硬执行。

## 能力

- **sparkos_run 工具**：`brief / topics / draft / distill / sources / publish / advise` 七个子命令执行每日内容工作流；写操作先过五守卫（48h 窗口 / event_id 去重 / 引用卡存在性 / 主线存在 / 建议只读）；支持 `dryRun` 只校验不落盘。
- **8-tab 工作台 UI**：宿主 webServer 挂载 `/sparkos/app`（今日简报 / 叙事主线 / 选题推荐 / 草稿工作区 / 知识卡 / 信息源 / 发布表现 / 系统建议），`_embeddedDailyData` 注入 + adopt/ignore 交互（`/sparkos/mutate`）。
- **数据与代码分离**：VAULT 默认 `~/DeepSeek harness/sparkos/`，首次启动幂等迁移并落 MANIFEST。
- **intel 信源扩展位**：`src/intel/types.ts` 预留 Provider 接口（仅类型与注册位，默认空，实现须走蓝图确认关卡）。
- **定时任务**：默认关闭；`SPARKOS_SCHEDULE=1` 时每日仅向 `VAULT/system/schedule.log` 追加"brief due"提醒，不做任何自动写操作。

## 安装（DSH profile）

```jsonc
// ~/.dsh/profiles/web/package.json
{ "dependencies": { "dsh-sparkos": "…" }, "dsh": { "bundles": ["dsh-sparkos"] } }
```

然后重启 DSH 宿主，访问 `http://<host>:<port>/sparkos/app`。

## 设计红线

- 星火知识库对插件**只读**；写回仅经 distill_queue 人工审核。
- 系统建议只读（守卫⑤），任何"采纳"动作都必须人工触发。

## 开发

```bash
npm run check   # tsc
npm test        # 守卫/VAULT/数据 双向测试
npm run build   # esbuild host 半 + client 半
```
