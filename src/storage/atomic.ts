/**
 * 原子文件写入工具：同目录临时文件 → fsync → rename → 失败清理。
 * 用于可变 JSON 状态，避免半写文件被后续读取误用。
 * @module dsh-sparkos/src/storage/atomic
 */

import { mkdirSync, renameSync, rmSync, writeFileSync, openSync, closeSync, fsyncSync } from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

/**
 * 原子写入一个文件：写入同目录隐藏临时文件（同文件系统保证 rename 原子性），
 * fsync 落盘后 rename 到目标；任何失败清理临时文件且不触碰目标。
 */
export function atomicWriteFile(target: string, content: string | Buffer, options: { mode?: number } = {}): void {
  const parent = path.dirname(target)
  mkdirSync(parent, { recursive: true })
  const staging = path.join(parent, '.' + path.basename(target) + '-' + randomUUID() + '.tmp')
  try {
    writeFileSync(staging, content, { mode: options.mode ?? 0o644 })
    // fsync 确保数据先于 rename 到达磁盘，崩溃后不会留下 0 字节/半写目标文件
    const fd = openSync(staging, 'r+')
    try { fsyncSync(fd) } finally { closeSync(fd) }
    renameSync(staging, target)
  } catch (error) {
    rmSync(staging, { force: true })
    throw error
  }
}

/** 便捷封装：JSON.stringify + 换行 + 原子写入。 */
export function atomicWriteJson(target: string, value: unknown, options: { mode?: number } = {}): void {
  atomicWriteFile(target, JSON.stringify(value, null, 2) + '\n', options)
}
