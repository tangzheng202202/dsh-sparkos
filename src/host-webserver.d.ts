/**
 * DSH webServer 服务类型声明（公开 clone / CI 环境用）。
 *
 * 说明：本机开发默认走 tsconfig.local.json 把 @deepseek-ai/* 映射到 DSH monorepo
 * 源码，其中 host/webserver 提供 Context.webServer 服务；npm 上发布的
 * @deepseek-ai/dsh-host-webserver 0.0.1-rc.1 类型里服务名是 httpServer（早期命名）。
 * 本声明让干净 clone（npm ci + npm run check）在已发布类型包下也能通过类型检查；
 * 运行时以宿主实际注入的服务为准（本插件经 cordis ctx.inject(['webServer']) 使用）。
 */
import type { Context } from '@deepseek-ai/cordis'

declare module '@deepseek-ai/cordis' {
  interface Context {
    webServer: {
      register(route: {
        kind: 'exact' | 'prefix'
        path: string
        handler: (req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => void | Promise<void>
      }): () => void
      registerUpgrade(route: {
        path: string
        handler: (req: import('node:http').IncomingMessage, socket: import('node:stream').Duplex, head: Buffer) => void | Promise<void>
      }): () => void
      registerFallback(handler: (req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => void | Promise<void>): () => void
      tapIndex(transform: (html: string) => string): () => void
      applyIndexTaps(html: string): string
      readonly port: number
      readonly host: string
    }
  }
}

export {}
