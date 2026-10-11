/**
 * The webContents allowed to call IPC and to receive events: the app's own windows.
 * A webContents is forgotten when it is destroyed. `revokeAll()` (the app is quitting)
 * forgets every one and trusts none from then on.
 */

/** The part of Electron's `WebContents` this module and `RendererEvents` use. */
export interface WebContentsLike {
  readonly id: number;
  isDestroyed(): boolean;
  send(channel: string, ...args: unknown[]): void;
  once(event: 'destroyed', listener: () => void): unknown;
}

export class TrustedWebContents {
  private readonly contents = new Map<number, WebContentsLike>();
  private revoked = false;

  register(webContents: WebContentsLike): void {
    if (this.revoked || this.contents.has(webContents.id)) return;
    this.contents.set(webContents.id, webContents);
    webContents.once('destroyed', () => this.contents.delete(webContents.id));
  }

  isTrusted(id: number): boolean {
    const webContents = this.contents.get(id);
    return webContents !== undefined && !webContents.isDestroyed();
  }

  list(): WebContentsLike[] {
    return Array.from(this.contents.values());
  }

  /** Trusts no webContents from now on: their invokes are refused and they get no events. */
  revokeAll(): void {
    this.revoked = true;
    this.contents.clear();
  }
}
