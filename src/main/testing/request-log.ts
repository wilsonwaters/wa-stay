/**
 * The unexpected-requests log of fixture mode: `<userData>/e2e-unexpected-requests.log`.
 *
 * One JSON object per line, appended by `FixtureHttpClient` (a provider request with no
 * fixture route), by the network guard (a request it cancelled) and by a document window's
 * partition (`fixture-documents.ts`: a request with no fixture route). The Electron smoke tests
 * read it after each run; an empty or missing file means the app stayed off the network.
 */

import fs from 'fs';
import path from 'path';

export const UNEXPECTED_REQUESTS_LOG = 'e2e-unexpected-requests.log';

export interface UnexpectedRequest {
  /** ISO time. */
  time: string;
  /** Who stopped the request. */
  source: 'fixture-http' | 'network-guard' | 'fixture-document';
  method: string;
  url: string;
  /** `fixture-http`, `fixture-document`: the provider that asked. */
  providerId?: string;
  /** `network-guard`: Chromium's resource type (`image`, `xhr`, `mainFrame`, …). */
  resourceType?: string;
}

export function unexpectedRequestsLogPath(userDataDir: string): string {
  return path.join(userDataDir, UNEXPECTED_REQUESTS_LOG);
}

/** Appends one entry. Never throws: a log that cannot be written must not change the app. */
export function appendUnexpectedRequest(
  file: string,
  entry: Omit<UnexpectedRequest, 'time'>,
  now: () => Date = () => new Date()
): void {
  const line = JSON.stringify({ time: now().toISOString(), ...entry });
  try {
    fs.appendFileSync(file, `${line}\n`, 'utf8');
  } catch {
    // The request is still refused; the test sees the refusal instead of the log line.
  }
}

/** Every entry in `file`; none when it does not exist. */
export function readUnexpectedRequests(file: string): UnexpectedRequest[] {
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as UnexpectedRequest);
}
