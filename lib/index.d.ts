/**
 * dsh-sparkos — DeepSeek Harness 自媒体工作台插件（host 半）。
 *
 * 数据与代码分离：默认 VAULT = $DSH_HOME/sparkos（未设 DSH_HOME 时是 ~/.dsh/sparkos）；
 * 星火知识库只读，写回仅经 distill_queue 人工审核。
 * @module dsh-sparkos/src/index
 */
import type { Context } from '@deepseek-ai/cordis';
export declare const name = "sparkos";
export declare const inject: string[];
export declare function apply(ctx: Context): void;
