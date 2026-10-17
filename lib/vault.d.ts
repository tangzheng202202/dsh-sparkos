/**
 * VAULT（数据区）路径解析与初始化迁移。
 *
 * 数据与代码分离：VAULT = ~/DeepSeek harness/sparkos/（不进 git）；
 * 星火知识库 (/Users/mac/cow/knowledge) 对插件只读，写回仅经 distill_queue 人工审核。
 * @module dsh-sparkos/src/vault
 */
export declare const VAULT_ROOT: string;
/** 只读外部资产（绝不写入）。 */
export declare const KNOWLEDGE_ROOT = "/Users/mac/cow/knowledge";
export declare const TIMELINE_DATA = "/Users/mac/cow/visualization/timeline_data.json";
export interface MigrationResult {
    migrated: Array<{
        dest: string;
        note: string;
    }>;
    alreadyPresent: string[];
    vaultRoot: string;
}
/** 幂等初始化：已有文件不覆盖，迁移清单落 vault/MANIFEST。 */
export declare function initVault(): MigrationResult;
