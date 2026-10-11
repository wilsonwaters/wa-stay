/**
 * In-memory provider windows for core tests (`core/accounts/ports.ts`): `FakeOpener` records
 * every window request, and each `FakeWindow` records focus, loads and closes, and replays the
 * pages a test "shows" in it to the service's listeners:
 * - `navigate(url)`: a committed page (`onNavigate`);
 * - `showPage(url, { text })`: a committed page that finished loading (`onLoaded`), whose
 *   text `hasText` finds (case-sensitive);
 * - `failFirstPage(message)`: the first page was blocked or failed, so the window closes itself.
 * The first page commits at once unless the opener's `autoCommit` is false.
 */

import type {
  ProviderWindowFailure,
  ProviderWindowHandle,
  ProviderWindowKind,
  ProviderWindowNavigation,
  ProviderWindowOpener,
  ProviderWindowRequest,
} from '@main/core/accounts/ports';
import { ProviderError } from '@main/providers/sdk/errors';

/** A window the service opened: records focus, loads and closes; replays navigations. */
export class FakeWindow implements ProviderWindowHandle {
  focused = 0;
  closed = false;
  /** The text the page shows now. */
  pageText = '';
  readonly loads: string[] = [];
  readonly loaded: Promise<void>;
  private resolveLoaded!: () => void;
  private rejectLoaded!: (error: Error) => void;
  private readonly navigationListeners = new Set<(n: ProviderWindowNavigation) => void>();
  private readonly loadedListeners = new Set<(n: ProviderWindowNavigation) => void>();
  private readonly closedListeners: Array<(failure?: ProviderWindowFailure) => void> = [];
  private failure?: Error;

  constructor(
    readonly providerId: string,
    readonly kind: ProviderWindowKind,
    public url: string,
    commitAtOnce = true
  ) {
    this.loaded = new Promise<void>((resolve, reject) => {
      this.resolveLoaded = resolve;
      this.rejectLoaded = reject;
    });
    this.loaded.catch(() => undefined);
    if (commitAtOnce) this.resolveLoaded();
  }

  focus(): void {
    this.focused++;
  }
  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.closedListeners.splice(0).forEach((listener) => listener(this.failure));
  }
  load(url: string): void {
    this.loads.push(url);
    this.url = url;
  }
  currentUrl(): string {
    return this.url;
  }
  onNavigate(listener: (n: ProviderWindowNavigation) => void): () => void {
    this.navigationListeners.add(listener);
    return () => this.navigationListeners.delete(listener);
  }
  onLoaded(listener: (n: ProviderWindowNavigation) => void): () => void {
    this.loadedListeners.add(listener);
    return () => this.loadedListeners.delete(listener);
  }
  onClosed(listener: (failure?: ProviderWindowFailure) => void): void {
    if (this.closed) listener(this.failure);
    else this.closedListeners.push(listener);
  }
  hasText(text: string): Promise<boolean> {
    return Promise.resolve(!this.closed && this.pageText.includes(text));
  }
  isClosed(): boolean {
    return this.closed;
  }
  /** A committed top-level page, with its HTTP status. */
  navigate(url: string, httpStatus = 200): void {
    this.url = url;
    this.resolveLoaded();
    for (const listener of [...this.navigationListeners]) listener({ url, httpStatus });
  }
  /** A committed page that finished loading and shows `text`. */
  showPage(
    url: string,
    { text = '', status = 200 }: { text?: string; status?: number } = {}
  ): void {
    this.pageText = text;
    this.navigate(url, status);
    for (const listener of [...this.loadedListeners]) listener({ url, httpStatus: status });
  }
  /** The first page was blocked or failed: `loaded` rejects and the window closes itself. */
  failFirstPage(message: string): void {
    this.failure = new ProviderError({ providerId: this.providerId, message });
    this.rejectLoaded(this.failure);
    this.close();
  }
}

export class FakeOpener implements ProviderWindowOpener {
  readonly requests: ProviderWindowRequest[] = [];
  readonly windows: FakeWindow[] = [];
  /** Whether a new window's first page commits at once. */
  autoCommit = true;
  open(request: ProviderWindowRequest): ProviderWindowHandle {
    this.requests.push(request);
    const window = new FakeWindow(request.providerId, request.kind, request.url, this.autoCommit);
    this.windows.push(window);
    return window;
  }
  find(providerId: string, kind: ProviderWindowKind): ProviderWindowHandle | undefined {
    return this.windows.find((w) => w.providerId === providerId && w.kind === kind && !w.closed);
  }
  closeAll(): void {
    this.windows.forEach((w) => w.close());
  }
  get last(): FakeWindow {
    return this.windows[this.windows.length - 1];
  }
}
