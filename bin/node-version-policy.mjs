// Minimum Node.js version accepted per release line. Only LTS lines that still receive security
// fixes are allowed, each at its latest security release.
//
// Current floor: October 2026 security release (CVE-2026-111497 "Node2Shell" Brotli RCE and
// 9 other CVEs): 22.23.4, 24.22.1, 26.12.1.
// Update this table (and package.json "engines", .nvmrc, CLAUDE.md) on every Node security release.
//
// Keep this file plain ES2015+ without newer syntax: it must run on old Node to print a clear error.

export const MINIMUM_PATCHED_VERSION_BY_MAJOR = {
  22: '22.23.4',
  24: '24.22.1',
  26: '26.12.1',
};

/** Release lines newer than the newest known LTS are accepted (future LTS / current releases). */
const NEWEST_KNOWN_MAJOR = 26;

function parseNodeVersion(versionText) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)/.exec(versionText);
  if (match === null) {
    return null;
  }
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function compareVersionParts(left, right) {
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) {
      return left[index] - right[index];
    }
  }
  return 0;
}

/**
 * @param {string} versionText e.g. process.version ("v22.23.4")
 * @returns {{ accepted: boolean, reason: string }}
 */
export function evaluateNodeVersion(versionText) {
  const version = parseNodeVersion(versionText);
  if (version === null) {
    return { accepted: false, reason: `Không đọc được phiên bản Node "${versionText}".` };
  }
  const major = version[0];
  const supportedLines = Object.values(MINIMUM_PATCHED_VERSION_BY_MAJOR).join(', ');

  if (major > NEWEST_KNOWN_MAJOR) {
    return { accepted: true, reason: `Node ${versionText} mới hơn các dòng LTS đã biết.` };
  }

  const minimumText = MINIMUM_PATCHED_VERSION_BY_MAJOR[major];
  if (minimumText === undefined) {
    return {
      accepted: false,
      reason: `Node ${versionText} không thuộc dòng LTS còn được vá bảo mật. Hãy cài một trong: ${supportedLines} (hoặc mới hơn trong cùng dòng).`,
    };
  }

  const minimum = parseNodeVersion(minimumText);
  if (compareVersionParts(version, minimum) < 0) {
    return {
      accepted: false,
      reason: `Node ${versionText} thiếu bản vá bảo mật. Cần tối thiểu v${minimumText} cho dòng ${major}.x.`,
    };
  }
  return {
    accepted: true,
    reason: `Node ${versionText} đã có bản vá bảo mật mới nhất của dòng ${major}.x.`,
  };
}
