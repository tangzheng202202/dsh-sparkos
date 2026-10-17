/**
 * `sparkos_run` — 工作台唯一入口工具：子命令对应 10 步工作流的代码化分步。
 * @module dsh-sparkos/src/tools/run
 */
import { defineTool } from '@deepseek-ai/dsh-tools';
import { initVault, VAULT_ROOT } from '../vault.ts';
export const SUBCOMMANDS = ['brief', 'topics', 'draft', 'distill', 'sources', 'publish', 'advise'];
export function usage() {
    return [
        'sparkos_run — SparkOS 自媒体工作台入口',
        `子命令：${SUBCOMMANDS.join(' / ')}`,
        '  brief    今日简报（信源增量 + 主线状态）',
        '  topics   选题推荐',
        '  draft    草稿工作区操作',
        '  distill  蒸馏审核（星火库写回仅经人工审核关卡）',
        '  sources  信息源管理（RSS + 星火库增量；intel 扩展位预留）',
        '  publish  发布表现',
        '  advise   系统建议（只读，守卫⑤）',
        '参数：action(string, 可选) 子命令；payload(object, 可选)；dryRun(bool) 只校验不落盘',
        `VAULT：${VAULT_ROOT}`,
    ].join('\n');
}
export function registerRunTool(ctx) {
    ctx.tools.register(defineTool({
        name: 'sparkos_run',
        description: 'SparkOS 自媒体工作台：brief/topics/draft/distill/sources/publish/advise 子命令执行每日内容工作流。写操作先过五守卫（48h窗口/event_id去重/引用卡存在/主线存在/建议只读）。不带参数返回用法。',
        parameters: {
            action: { type: 'string', description: `子命令：${SUBCOMMANDS.join(' | ')}` },
            payload: { type: 'object', additionalProperties: true, description: '子命令参数' },
            dryRun: { type: 'boolean', description: '只校验不落盘' },
        },
        output: {
            schema: { type: 'object', additionalProperties: false, properties: { text: { type: 'string', required: true } } },
            render: (_args, value) => [{ type: 'text', text: value.text }],
        },
        isConcurrencySafe: () => true,
        async execute(args) {
            if (args.action === undefined)
                return { text: usage() };
            if (!SUBCOMMANDS.includes(args.action)) {
                return { text: `未知子命令：${args.action}\n${usage()}` };
            }
            const dryRun = args.dryRun === true;
            if (dryRun) {
                return { text: `[dryRun] ${args.action} 参数校验通过，未落盘。payload keys: ${Object.keys(args.payload ?? {}).join(',') || '(空)'}` };
            }
            const vault = initVault();
            // TODO(P0.3 各子命令实现 / P0.4 守卫接入)
            return { text: `${args.action} 已受理（骨架阶段）。vault=${vault.vaultRoot} 迁移=${vault.migrated.length} 已存在=${vault.alreadyPresent.length}` };
        },
    }));
}
