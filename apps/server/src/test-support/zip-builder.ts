import { crc32, deflateRawSync } from 'node:zlib';

export interface ZipFixtureFile {
  path: string;
  content: string | Buffer;
  /** Marks the entry as a Unix symlink (the content is the link target). */
  symlink?: boolean;
  /** Declared size different from the real one (to test size checks). */
  declaredSize?: number;
}

/** Builds a small ZIP archive (deflate) in memory for tests. */
export function buildZipArchive(files: readonly ZipFixtureFile[]): Buffer {
  const localParts: Buffer[] = [];
  const directoryParts: Buffer[] = [];
  let offset = 0;
  for (const file of files) {
    const name = Buffer.from(file.path, 'utf8');
    const content = Buffer.isBuffer(file.content)
      ? file.content
      : Buffer.from(file.content, 'utf8');
    const compressed = deflateRawSync(content);
    const checksum = crc32(content);
    const size = file.declaredSize ?? content.length;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(size, 22);
    local.writeUInt16LE(name.length, 26);
    localParts.push(local, name, compressed);

    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE((3 << 8) | 20, 4); // made by Unix
    entry.writeUInt16LE(20, 6);
    entry.writeUInt16LE(0x0800, 8);
    entry.writeUInt16LE(8, 10);
    entry.writeUInt32LE(checksum, 16);
    entry.writeUInt32LE(compressed.length, 20);
    entry.writeUInt32LE(size, 24);
    entry.writeUInt16LE(name.length, 28);
    const mode = file.symlink === true ? 0o120777 : 0o100644;
    entry.writeUInt32LE((mode << 16) >>> 0, 38);
    entry.writeUInt32LE(offset, 42);
    directoryParts.push(entry, name);

    offset += local.length + name.length + compressed.length;
  }
  const directory = Buffer.concat(directoryParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...localParts, directory, end]);
}
