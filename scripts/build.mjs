/**
 * Build the host and client halves into lib/.
 * - Host: ESM bundle (esbuild), externals = node builtins, @deepseek-ai/*, sharp.
 * - Client: authored as a plain factory body (React.createElement, require()),
 *   wrapped into the window.__ModuleLoader__.load closure format.
 */
import { build } from 'esbuild'
import { readFileSync, writeFileSync, mkdirSync, rmSync, copyFileSync } from 'node:fs'

async function run() {
  mkdirSync('lib', { recursive: true })

  await build({
    entryPoints: ['src/index.ts'],
    outfile: 'lib/index.js',
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    packages: 'external',
    loader: { '.html': 'text' },
    sourcemap: false,
    banner: { js: '/* dsh-sparkos host half — built. Edit src/, then `pnpm build`. */' },
    logLevel: 'info',
  })

  const inner = readFileSync('src/client/index.js', 'utf8')
  const wrapped = `/* dsh-sparkos client half — built. Edit src/client/, then \`pnpm build\`. */
window.__ModuleLoader__.load({
  id: 'dsh-sparkos',
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })
${indent(inner, 4)}
    return module.exports
  },
})
`
  writeFileSync('lib/client.js', wrapped)
  copyFileSync('src/server/page.template.html', 'lib/page.template.html')
  copyFileSync('src/server/page-v2.template.html', 'lib/page-v2.template.html')
  rmSync('lib/client.tmp.js', { force: true })
  console.log('built lib/index.js, lib/client.js and page templates')
}

function indent(source, spaces) {
  const pad = ' '.repeat(spaces)
  return source.split('\n').map(line => (line.trim() === '' ? '' : pad + line)).join('\n')
}

run().catch((error) => {
  console.error(error)
  process.exit(1)
})
