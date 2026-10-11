import type { UpdateCheckOutcome } from '../../../api';

/** What a finished update check says, in words. */
export function updateCheckMessage(outcome: UpdateCheckOutcome, current?: string): string {
  const { status, latest } = outcome;
  const version = status.version ?? latest;
  switch (status.state) {
    case 'not-available':
      return "You're up to date";
    case 'available':
      return `Version ${version} is available`;
    case 'downloading':
      return `Version ${version} is downloading`;
    case 'downloaded':
      return `Version ${version} is ready to install`;
    case 'error':
      return status.error
        ? `Couldn't check for updates: ${status.error}`
        : "Couldn't check for updates";
    default:
      return latest && current && latest !== current
        ? `Version ${latest} is available`
        : "You're up to date";
  }
}
