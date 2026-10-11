// Vite replaces `process.env.NODE_ENV` in renderer code at dev and build time; Jest runs on Node.
declare const process: { env: { NODE_ENV?: string } };

/** Logs a developer warning outside production builds. */
export function devWarn(message: string): void {
  if (process.env.NODE_ENV !== 'production') {
    console.warn(`[ui] ${message}`);
  }
}
