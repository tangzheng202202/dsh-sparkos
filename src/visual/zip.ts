/** Small deterministic, store-only ZIP writer for auditable delivery bundles. */

export interface ZipEntry {
  path: string
  data: Uint8Array
}

const FORBIDDEN = /(^|\/)(?:\.DS_Store|\._[^/]+|[^/]+\.(?:tmp|temp|swp)|~[^/]*)$/i

function safeZipPath(value: string): string {
  const normalized = value.replaceAll('\\', '/')
  if (normalized === '' || normalized.startsWith('/') || /^[a-z]:\//i.test(normalized)
    || normalized.split('/').some((part) => part === '' || part === '.' || part === '..')
    || FORBIDDEN.test(normalized)) {
    throw new Error('不安全的 ZIP 条目：' + value)
  }
  return normalized
}

const CRC_TABLE = Array.from({ length: 256 }, (_, index) => {
  let value = index
  for (let bit = 0; bit < 8; bit += 1) value = (value & 1) !== 0 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
  return value >>> 0
})

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff
  for (const byte of data) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

function localHeader(name: Buffer, data: Buffer, crc: number): Buffer {
  const header = Buffer.alloc(30)
  header.writeUInt32LE(0x04034b50, 0)
  header.writeUInt16LE(20, 4)
  header.writeUInt16LE(0x0800, 6) // UTF-8
  header.writeUInt16LE(0, 8) // stored
  header.writeUInt16LE(0, 10) // 00:00:00
  header.writeUInt16LE(0x0021, 12) // 1980-01-01
  header.writeUInt32LE(crc, 14)
  header.writeUInt32LE(data.byteLength, 18)
  header.writeUInt32LE(data.byteLength, 22)
  header.writeUInt16LE(name.byteLength, 26)
  return header
}

function centralHeader(name: Buffer, data: Buffer, crc: number, offset: number): Buffer {
  const header = Buffer.alloc(46)
  header.writeUInt32LE(0x02014b50, 0)
  header.writeUInt16LE(0x0314, 4) // Unix, ZIP 2.0
  header.writeUInt16LE(20, 6)
  header.writeUInt16LE(0x0800, 8)
  header.writeUInt16LE(0, 10)
  header.writeUInt16LE(0, 12)
  header.writeUInt16LE(0x0021, 14)
  header.writeUInt32LE(crc, 16)
  header.writeUInt32LE(data.byteLength, 20)
  header.writeUInt32LE(data.byteLength, 24)
  header.writeUInt16LE(name.byteLength, 28)
  header.writeUInt32LE((0o100644 << 16) >>> 0, 38)
  header.writeUInt32LE(offset, 42)
  return header
}

export function deterministicZip(input: ZipEntry[]): Buffer {
  const entries = input.map((entry) => ({ path: safeZipPath(entry.path), data: Buffer.from(entry.data) }))
    .sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0)
  if (new Set(entries.map((entry) => entry.path)).size !== entries.length) throw new Error('ZIP 条目重复')
  const locals: Buffer[] = []
  const central: Buffer[] = []
  let offset = 0
  for (const entry of entries) {
    const name = Buffer.from(entry.path, 'utf8')
    const crc = crc32(entry.data)
    const header = localHeader(name, entry.data, crc)
    locals.push(header, name, entry.data)
    central.push(centralHeader(name, entry.data, crc, offset), name)
    offset += header.byteLength + name.byteLength + entry.data.byteLength
  }
  const centralSize = central.reduce((sum, item) => sum + item.byteLength, 0)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(centralSize, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, ...central, end])
}
