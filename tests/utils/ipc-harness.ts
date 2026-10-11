/**
 * Test doubles for the IPC layer: a fake `ipcMain`, invoke events with a configurable
 * sender and frame, and fake webContents that record what they were sent.
 */

import os from 'os';
import path from 'path';
import { pathToFileURL } from 'url';
import type { IpcMainInvokeEvent } from 'electron';
import type { IpcMainLike } from '@main/ipc/handle';
import type { WebContentsLike } from '@main/ipc/trusted-web-contents';

type Listener = (event: IpcMainInvokeEvent, ...args: unknown[]) => Promise<unknown>;

/** Records every `handle` registration and lets a test invoke a channel as the renderer would. */
export class FakeIpcMain implements IpcMainLike {
  /** Every channel passed to `handle`, in order, duplicates included. */
  readonly registrations: string[] = [];
  private readonly listeners = new Map<string, Listener>();

  handle(channel: string, listener: Listener): void {
    this.registrations.push(channel);
    this.listeners.set(channel, listener);
  }

  invoke(channel: string, event: IpcMainInvokeEvent, ...args: unknown[]): Promise<unknown> {
    const listener = this.listeners.get(channel);
    if (!listener) throw new Error(`No handler registered for ${channel}`);
    return listener(event, ...args);
  }
}

/** The built renderer, at a path with a space in it (like `C:\Program Files\WA Stay`). */
export const APP_INDEX_PATH = path.join(os.tmpdir(), 'WA Stay', 'dist', 'renderer', 'index.html');
export const APP_URL = `${pathToFileURL(APP_INDEX_PATH).href}#/watches`;
/** A container's log folder in tests. Nothing is written there unless a test opens it. */
export const TEST_LOGS_DIR = path.join(os.tmpdir(), 'WA Stay', 'logs');
export const TRUSTED_SENDER_ID = 1;

export interface FakeFrame {
  url: string;
  parent: FakeFrame | null;
}

export function topFrame(url: string = APP_URL): FakeFrame {
  return { url, parent: null };
}

export function fakeEvent(
  options: { senderId?: number; frame?: FakeFrame | null } = {}
): IpcMainInvokeEvent {
  const frame = options.frame === undefined ? topFrame() : options.frame;
  return {
    sender: { id: options.senderId ?? TRUSTED_SENDER_ID },
    senderFrame: frame,
  } as unknown as IpcMainInvokeEvent;
}

export interface FakeWebContents extends WebContentsLike {
  readonly sent: Array<[string, unknown]>;
  destroy(): void;
}

export function fakeWebContents(id: number): FakeWebContents {
  let destroyed = false;
  const onDestroyed: Array<() => void> = [];
  const sent: Array<[string, unknown]> = [];
  return {
    id,
    sent,
    isDestroyed: () => destroyed,
    send: (channel: string, payload: unknown) => {
      sent.push([channel, payload]);
    },
    once: (_event: 'destroyed', listener: () => void) => {
      onDestroyed.push(listener);
    },
    destroy: () => {
      destroyed = true;
      onDestroyed.splice(0).forEach((listener) => listener());
    },
  };
}
