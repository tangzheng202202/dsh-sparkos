# SparkOS 内容工厂 M1 + M2

## 目标

本阶段把现有“文件型情报工作台”升级为可恢复、可追溯的内容工厂底座：

- SQLite 保存可变状态；VAULT 继续保存可读的原始文件和产物。
- 长任务使用明确状态机，不在 HTTP 请求里默默执行。
- 情报簇提交后生成可解释的每日 Top 5、上升榜、连续霸榜与创作候选。
- 只有证据等级 A/B 的主题可以进入创作候选；发布仍需人工批准。

## 运行要求

- Node.js `>=22.13.0`（使用内置 `node:sqlite`，无需安装原生 SQLite 扩展）。
- 数据库默认：`$SPARKOS_VAULT_ROOT/data/sparkos.db`。
- 可用 `SPARKOS_DB_PATH` 覆盖数据库位置。

## 数据边界

| 数据 | 存储 | 原则 |
|---|---|---|
| 原始情报、快照、融合文件、草稿、图片 | VAULT 文件 | 不可变、可人工查看 |
| 任务状态、租约、失败重试、排名历史、审批 | SQLite | 事务、唯一约束、可恢复 |
| 星火知识库 | 外部只读 | 写回继续走人工审核 |

## 任务状态机

`queued → running → waiting_approval / succeeded / failed / cancelled`

- 创建任务支持 `idempotency_key`，重复调度不会重复生产。
- Worker claim 后获得有限期 lease；运行期间需 heartbeat。
- lease 到期且仍有尝试次数时自动回到 queued；次数耗尽标记 failed。
- succeeded/cancelled 是终态，禁止静默重跑。

## 证据等级

- A：已验证的官方/第一方来源。
- B：至少两个相互独立、已验证的可靠来源。
- C：只有一个已验证来源。
- D：未验证或存在未解决冲突。

热度榜可以展示 C/D 以反映舆论，但创作候选只接受 A/B。

## 评分

热度分：信息量 25% + 增速 20% + 独立来源 15% + 权威度 15% + 持续性 15% + 受众相关度 10%。

选题价值：热度 30% + 新颖度 20% + 知识深度 20% + 平台适配 15% + 独立判断 15% - 风险扣分。

所有分项写入 `breakdown_json`，工作台不会只显示无法解释的总分。

## Agent 提交情报簇

在原字段之外，建议提交：

```json
{
  "topicKey": "t-agent-content-factory",
  "evidence": [
    {
      "url": "https://example.com/original",
      "claim": "可核验事实",
      "sourceType": "official",
      "independenceGroup": "example-official",
      "verified": true,
      "contradicts": false
    }
  ],
  "judgment": {
    "confirmedFacts": ["已确认事实"],
    "inferences": ["基于事实的推断"],
    "editorialView": "编辑判断与解读",
    "counterArguments": ["主要反方观点"],
    "uncertainties": ["仍未确定的部分"]
  }
}
```

同一跨日话题应保持相同 `topicKey`，即使标题发生变化；这是连续霸榜统计的稳定身份。

## 使用

```text
sparkos_run {action:"intel", payload:{fusion:true}}
sparkos_run {action:"intel", payload:{analyze:true}}
sparkos_run {action:"intel", payload:{submitCluster:{...}}}
sparkos_run {action:"intel", payload:{rank:true}}
sparkos_run {action:"intel", payload:{jobs:true}}
```

`submitCluster` 成功后会自动刷新排名；`rank:true` 用于显式重跑。同一批情报簇内容未变化时，排名任务会幂等复用。
