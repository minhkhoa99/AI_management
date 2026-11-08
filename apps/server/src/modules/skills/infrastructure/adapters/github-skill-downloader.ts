import { Injectable } from '@nestjs/common';
import { SKILL_UPLOAD_MAX_BYTES } from '@aiteam/contracts';
import { ValidationError } from '../../../../shared/errors/app-error';
import type {
  GithubSkillDownloader,
  GithubSkillSource,
} from '../../application/ports/skill-sources.ports';

/** A whole repository archive may be bigger than one skill; only its skill folder is kept. */
const ARCHIVE_MAX_BYTES = 50 * 1024 * 1024;
const DOWNLOAD_TIMEOUT_MS = 60_000;
const MAX_REDIRECTS = 3;
/** Redirects are followed only within GitHub's own download hosts. */
const ALLOWED_HOSTS = new Set([
  'github.com',
  'codeload.github.com',
  'raw.githubusercontent.com',
  'objects.githubusercontent.com',
]);

export interface ParsedGithubSkillUrl {
  owner: string;
  repository: string;
  ref: string;
  /** Folder inside the repository ("" = root), or the .md file for kind "markdown". */
  path: string;
  kind: 'folder' | 'markdown';
}

/**
 * https://github.com/<owner>/<repo>                       → the repository root (default branch)
 * https://github.com/<owner>/<repo>/tree/<ref>/<folder>    → that folder
 * https://github.com/<owner>/<repo>/blob/<ref>/<dir>/SKILL.md → the folder holding it
 * https://github.com/<owner>/<repo>/blob/<ref>/<file>.md   → that single file
 * The ref is one path segment (branch names with "/" are not supported).
 */
export function parseGithubSkillUrl(url: string): ParsedGithubSkillUrl {
  const match =
    /^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?(?:\/(tree|blob)\/([^/\s?#]+)((?:\/[^\s?#]+)*))?\/?$/.exec(
      url.trim(),
    );
  if (match === null) {
    throw new ValidationError('Link GitHub không đúng dạng.', { code: 'GITHUB_URL_INVALID' });
  }
  const [, owner = '', repository = '', type, ref, rest = ''] = match;
  const segments = decodeURIComponent(rest)
    .split('/')
    .filter((segment) => segment !== '');
  if (segments.some((segment) => segment === '..' || segment === '.')) {
    throw new ValidationError('Link GitHub không đúng dạng.', { code: 'GITHUB_URL_INVALID' });
  }
  const filePath = segments.join('/');
  if (type === 'blob') {
    if (!/\.md$/i.test(filePath)) {
      throw new ValidationError(
        'Link tới file phải là file .md (hoặc dùng link thư mục /tree/…).',
        {
          code: 'GITHUB_URL_INVALID',
        },
      );
    }
    if ((segments.at(-1) ?? '').toLowerCase() === 'skill.md') {
      return {
        owner,
        repository,
        ref: ref!,
        path: segments.slice(0, -1).join('/'),
        kind: 'folder',
      };
    }
    return { owner, repository, ref: ref!, path: filePath, kind: 'markdown' };
  }
  return { owner, repository, ref: ref ?? 'HEAD', path: filePath, kind: 'folder' };
}

/** Public repositories only (no token is ever sent). */
@Injectable()
export class FetchGithubSkillDownloader implements GithubSkillDownloader {
  async downloadGithubSkill(url: string): Promise<GithubSkillSource> {
    const parsed = parseGithubSkillUrl(url);
    const encode = (value: string) => value.split('/').map(encodeURIComponent).join('/');
    if (parsed.kind === 'markdown') {
      const text = await downloadLimited(
        `https://raw.githubusercontent.com/${parsed.owner}/${parsed.repository}/${encode(parsed.ref)}/${encode(parsed.path)}`,
        SKILL_UPLOAD_MAX_BYTES,
      );
      return { kind: 'markdown', text: text.toString('utf8') };
    }
    const archive = await downloadLimited(
      `https://codeload.github.com/${parsed.owner}/${parsed.repository}/zip/${encode(parsed.ref)}`,
      ARCHIVE_MAX_BYTES,
    );
    return {
      kind: 'archive',
      archive,
      selection: { folder: parsed.path === '' ? null : parsed.path, stripTopFolder: true },
    };
  }
}

async function downloadLimited(startUrl: string, maxBytes: number): Promise<Buffer> {
  let url = startUrl;
  for (let redirects = 0; ; redirects += 1) {
    let response: Response;
    try {
      response = await fetch(url, {
        redirect: 'manual',
        signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
        headers: { 'user-agent': 'aimanagement-skill-import' },
      });
    } catch (error) {
      throw new ValidationError(`Không tải được từ GitHub: ${(error as Error).message}`, {
        code: 'GITHUB_DOWNLOAD_FAILED',
        cause: error,
      });
    }
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      const next = location === null ? null : new URL(location, url);
      if (
        next === null ||
        next.protocol !== 'https:' ||
        !ALLOWED_HOSTS.has(next.hostname) ||
        redirects >= MAX_REDIRECTS
      ) {
        throw new ValidationError('GitHub chuyển hướng tới nơi không cho phép.', {
          code: 'GITHUB_DOWNLOAD_FAILED',
        });
      }
      url = next.toString();
      continue;
    }
    if (response.status === 404) {
      throw new ValidationError(
        'Không tìm thấy trên GitHub: kiểm tra link, tên nhánh, và repo phải công khai.',
        { code: 'GITHUB_NOT_FOUND' },
      );
    }
    if (!response.ok || response.body === null) {
      throw new ValidationError(`GitHub trả lỗi HTTP ${response.status}.`, {
        code: 'GITHUB_DOWNLOAD_FAILED',
      });
    }
    return readBodyLimited(response.body, maxBytes);
  }
}

async function readBodyLimited(
  body: ReadableStream<Uint8Array>,
  maxBytes: number,
): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  const reader = body.getReader();
  for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read()) {
    total += chunk.value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new ValidationError(
        `Tải về quá lớn (hơn ${Math.round(maxBytes / 1024 / 1024)} MB). Hãy dùng link tới đúng thư mục skill.`,
        { code: 'GITHUB_DOWNLOAD_TOO_LARGE' },
      );
    }
    chunks.push(Buffer.from(chunk.value));
  }
  return Buffer.concat(chunks);
}
