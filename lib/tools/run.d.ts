/**
 * `sparkos_run` — 工作台唯一入口工具：子命令对应 10 步工作流的代码化分步。
 * @module dsh-sparkos/src/tools/run
 */
import type { Context } from '@deepseek-ai/cordis';
export declare const SUBCOMMANDS: readonly ["brief", "topics", "draft", "distill", "sources", "publish", "advise"];
export type Subcommand = (typeof SUBCOMMANDS)[number];
export declare function usage(): string;
export declare function registerRunTool(ctx: Context): void;
