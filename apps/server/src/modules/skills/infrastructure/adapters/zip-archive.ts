import { inflateRawSync } from 'node:zlib';
import { ValidationError } from '../../../../shared/errors/app-error';

/** One file of a ZIP archive, read from the central directory (nothing is inflated yet). */
export interface ZipFileEntry {
  /** "/" separated, checked: relative, no "..", no empty segment. */
  path: string;
  compressedSize: number;
  size: number;
  method: number;
  localHeaderOffset: number;
}

const END_OF_DIRECTORY_SIGNATURE = 0x06054b50;
const DIRECTORY_ENTRY_SIGNATURE = 0x02014b50;
const LOCAL_HEADER_SIGNATURE = 0x04034b50;
const END_OF_DIRECTORY_MIN_LENGTH = 22;
const MAX_COMMENT_LENGTH = 0xffff;
const MAX_ENTRIES = 20_000;
const METHOD_STORED = 0;
const METHOD_DEFLATED = 8;
const UNIX_HOST = 3;
const SYMLINK_MODE = 0o120000;
const FILE_TYPE_MASK = 0o170000;

function invalidArchive(message: string): ValidationError {
  return new ValidationError(`File zip không hợp lệ: ${message}`, {
    code: 'SKILL_ARCHIVE_INVALID',
  });
}

/**
 * Lists the regular files of a ZIP archive (uploaded by the user or downloaded from GitHub).
 * Written for untrusted input: ZIP64, encrypted entries and symlinks are refused, paths that
 * could leave the target folder ("..", absolute, drive letters) are refused, directories are
 * skipped. Nothing is inflated here; see readZipFile.
 */
export function listZipFiles(archive: Buffer): ZipFileEntry[] {
  const endOffset = findEndOfDirectory(archive);
  const entryCount = archive.readUInt16LE(endOffset + 10);
  const directorySize = archive.readUInt32LE(endOffset + 12);
  const directoryOffset = archive.readUInt32LE(endOffset + 16);
  if (entryCount === 0xffff || directoryOffset === 0xffffffff || directorySize === 0xffffffff) {
    throw invalidArchive('định dạng ZIP64 chưa được hỗ trợ');
  }
  if (entryCount > MAX_ENTRIES) throw invalidArchive(`quá ${MAX_ENTRIES} mục`);
  if (directoryOffset + directorySize > endOffset) throw invalidArchive('mục lục sai vị trí');

  const files: ZipFileEntry[] = [];
  let offset = directoryOffset;
  for (let index = 0; index < entryCount; index += 1) {
    if (offset + 46 > endOffset || archive.readUInt32LE(offset) !== DIRECTORY_ENTRY_SIGNATURE) {
      throw invalidArchive('mục lục bị hỏng');
    }
    const madeBy = archive.readUInt16LE(offset + 4);
    const flags = archive.readUInt16LE(offset + 8);
    const method = archive.readUInt16LE(offset + 10);
    const compressedSize = archive.readUInt32LE(offset + 20);
    const size = archive.readUInt32LE(offset + 24);
    const nameLength = archive.readUInt16LE(offset + 28);
    const extraLength = archive.readUInt16LE(offset + 30);
    const commentLength = archive.readUInt16LE(offset + 32);
    const externalAttributes = archive.readUInt32LE(offset + 38);
    const localHeaderOffset = archive.readUInt32LE(offset + 42);
    const rawName = archive.subarray(offset + 46, offset + 46 + nameLength).toString('utf8');
    offset += 46 + nameLength + extraLength + commentLength;

    if (rawName.endsWith('/') || rawName.endsWith('\\')) continue; // directory
    if ((flags & 0x1) !== 0) throw invalidArchive(`"${rawName}" được mã hoá`);
    const isSymlink =
      madeBy >> 8 === UNIX_HOST && ((externalAttributes >>> 16) & FILE_TYPE_MASK) === SYMLINK_MODE;
    if (isSymlink) throw invalidArchive(`"${rawName}" là liên kết tượng trưng`);
    if (method !== METHOD_STORED && method !== METHOD_DEFLATED) {
      throw invalidArchive(`"${rawName}" dùng kiểu nén chưa hỗ trợ`);
    }
    files.push({
      path: normaliseEntryPath(rawName),
      compressedSize,
      size,
      method,
      localHeaderOffset,
    });
  }
  return files;
}

/** Inflates one entry; the size must match the directory (no zip bomb beyond `size`). */
export function readZipFile(archive: Buffer, entry: ZipFileEntry): Buffer {
  const header = entry.localHeaderOffset;
  if (header + 30 > archive.length || archive.readUInt32LE(header) !== LOCAL_HEADER_SIGNATURE) {
    throw invalidArchive(`"${entry.path}" bị hỏng`);
  }
  const dataStart =
    header + 30 + archive.readUInt16LE(header + 26) + archive.readUInt16LE(header + 28);
  const dataEnd = dataStart + entry.compressedSize;
  if (dataEnd > archive.length) throw invalidArchive(`"${entry.path}" bị cắt cụt`);
  const compressed = archive.subarray(dataStart, dataEnd);
  let content: Buffer;
  if (entry.method === METHOD_STORED) {
    content = Buffer.from(compressed);
  } else {
    try {
      // One byte of slack: anything longer than declared fails the size check below.
      content = inflateRawSync(compressed, { maxOutputLength: entry.size + 1 });
    } catch (error) {
      throw invalidArchive(`"${entry.path}" không giải nén được (${(error as Error).message})`);
    }
  }
  if (content.length !== entry.size) throw invalidArchive(`"${entry.path}" sai kích thước`);
  return content;
}

function findEndOfDirectory(archive: Buffer): number {
  const lowest = Math.max(0, archive.length - END_OF_DIRECTORY_MIN_LENGTH - MAX_COMMENT_LENGTH);
  for (let offset = archive.length - END_OF_DIRECTORY_MIN_LENGTH; offset >= lowest; offset -= 1) {
    if (archive.readUInt32LE(offset) === END_OF_DIRECTORY_SIGNATURE) return offset;
  }
  throw invalidArchive('không phải file zip');
}

function normaliseEntryPath(rawName: string): string {
  const name = rawName.replaceAll('\\', '/');
  const segments = name.split('/');
  const unsafe =
    name.includes('\0') ||
    name.startsWith('/') ||
    /^[a-zA-Z]:/.test(name) ||
    segments.some((segment) => segment === '' || segment === '.' || segment === '..');
  if (unsafe) throw invalidArchive(`đường dẫn "${rawName}" không an toàn`);
  return name;
}
