/**
 * 与 dsh web 一致的请求准入。
 *
 * 宿主 `ctx.connection.admit()` 在 0.2.0-rc.2 上返回两种结果：
 * - `{ peer }`：peer 是 operator，只有 id / ctx / scope，没有 principal
 * - `{ rejection: 401 | 403 }`
 * 未准入的响应只有短文本，不带本机绝对路径。
 * @module dsh-sparkos/src/server/access
 */

import type { IncomingMessage, ServerResponse } from 'node:http'

/** 0.2.x operator。不要读 principal，这份运行时没有这个字段。 */
export interface SparkosOperator {
  readonly id: string
  readonly ctx: unknown
  readonly scope?: unknown
}

export type SparkosAdmission =
  | { readonly peer: SparkosOperator }
  | { readonly rejection: 401 | 403 }

export type SparkosAdmit = (request: Pick<IncomingMessage, 'headers'>) => SparkosAdmission

/** 没接上宿主 connection 时拒绝。测试要显式传入 admitTestOperator。 */
export function denyAdmission(): SparkosAdmission {
  return { rejection: 401 }
}

/** 测试里当作已经登录的 operator。字段与 0.2.0-rc.2 一致，不含 principal。 */
export function admitTestOperator(): SparkosAdmission {
  return { peer: { id: 'test-operator', ctx: { scope: 'test' }, scope: 'test' } }
}

export function refuseAdmission(res: ServerResponse, status: 401 | 403): void {
  res.writeHead(status, {
    'content-type': 'text/plain; charset=utf-8',
    'cache-control': 'private, no-store',
  })
  res.end(status === 401 ? 'unauthorized' : 'forbidden')
}
