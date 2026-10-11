/**
 * Typed IPC handlers. `handle(def, fn)` is the only place `ipcMain.handle` is called.
 *
 * For every call it:
 * 1. checks the sender (`isTrustedSender`: a registered webContents, its top frame, on the
 *    app origin) and answers FORBIDDEN otherwise;
 * 2. parses the single payload argument with the method's zod schema (VALIDATION, with the
 *    failing paths, otherwise);
 * 3. runs `fn` with the parsed payload and maps the outcome to an `APIResponse`:
 *    `{ success: true, data }`, or `{ success: false, code, error }`. An `AppError` carries
 *    its code; a `ProviderError` maps through `toApiError` (e.g. `ProviderCapabilityError`
 *    → `CAPABILITY`); anything else is `INTERNAL`.
 *
 * Logs name the channel and, for validation failures, the failing paths. Payload values are
 * never logged (account and notifier payloads carry secrets), and a response never
 * carries a stack. The returned promise always resolves, so a handler that fails after its
 * window has closed cannot become an unhandled rejection.
 */

import { ipcMain, IpcMainInvokeEvent } from 'electron';
import { ZodError } from 'zod';
import type { MethodDef, RequestOutput, ResponseOf } from '@shared/contracts/define';
import type { APIResponse } from '@shared/types/api.types';
import { ProviderError, toApiError } from '../providers/sdk/errors';
import { AppError } from '../utils/app-error';
import { logger } from '../utils/logger';

/** Decides whether an invoke may run. Must not throw; a throw is treated as "no". */
export type SenderGuard = (event: IpcMainInvokeEvent) => boolean;

/** The part of `ipcMain` that `handle` uses (a fake in tests). */
export interface IpcMainLike {
  handle(
    channel: string,
    listener: (event: IpcMainInvokeEvent, ...args: unknown[]) => Promise<unknown>
  ): void;
}

export type HandlerFn<D extends MethodDef> = (
  payload: RequestOutput<D>
) => ResponseOf<D> | Promise<ResponseOf<D>>;

export type Handle = <D extends MethodDef>(def: D, fn: HandlerFn<D>) => void;

export interface HandleOptions {
  isTrustedSender: SenderGuard;
  ipc?: IpcMainLike;
}

export function createHandle({ isTrustedSender, ipc = ipcMain }: HandleOptions): Handle {
  return (def, fn) => {
    ipc.handle(def.channel, (event, ...args) => invoke(def, fn, isTrustedSender, event, args));
  };
}

async function invoke<D extends MethodDef>(
  def: D,
  fn: HandlerFn<D>,
  isTrustedSender: SenderGuard,
  event: IpcMainInvokeEvent,
  args: unknown[]
): Promise<APIResponse<ResponseOf<D>>> {
  const { channel } = def;

  if (!senderAllowed(isTrustedSender, event)) {
    logger.warn(`IPC ${channel} rejected: untrusted sender`);
    return { success: false, code: 'FORBIDDEN', error: 'Forbidden' };
  }

  if (args.length > 1) {
    logger.warn(`IPC ${channel} rejected: expected one payload argument, got ${args.length}`);
    return { success: false, code: 'VALIDATION', error: 'Invalid request', issues: [] };
  }

  const parsed = def.request.safeParse(args[0]);
  if (!parsed.success) {
    return validationFailure(channel, parsed.error);
  }

  try {
    // zod types a generic schema's output as its constraint's (`unknown`); this is the
    // method's own schema, so the data is the handler's payload type.
    const data = await fn(parsed.data as RequestOutput<D>);
    return { success: true, data };
  } catch (error) {
    return failure(channel, error);
  }
}

function senderAllowed(isTrustedSender: SenderGuard, event: IpcMainInvokeEvent): boolean {
  try {
    return isTrustedSender(event) === true;
  } catch {
    // e.g. the frame was disposed while we looked at it
    return false;
  }
}

/** Dotted issue paths, e.g. `id` or `updates.arrivalDate`; `(root)` for the payload itself. */
function issuePaths(error: ZodError): string[] {
  const paths = error.issues.map((issue) => (issue.path.length ? issue.path.join('.') : '(root)'));
  return Array.from(new Set(paths));
}

function validationFailure(channel: string, error: ZodError): APIResponse<never> {
  const issues = issuePaths(error);
  logger.warn(`IPC ${channel} rejected: invalid request at ${issues.join(', ')}`);
  return {
    success: false,
    code: 'VALIDATION',
    error: `Invalid request: ${issues.join(', ')}`,
    issues,
  };
}

function failure(channel: string, error: unknown): APIResponse<never> {
  if (error instanceof ZodError) {
    return validationFailure(channel, error);
  }
  if (error instanceof AppError) {
    if (error.code === 'INTERNAL') {
      logger.error(`IPC ${channel} failed:`, error);
    } else {
      logger.warn(`IPC ${channel} failed: ${error.code}`);
    }
    return {
      success: false,
      code: error.code,
      error: error.message,
      ...(error.issues ? { issues: error.issues } : {}),
    };
  }
  if (error instanceof ProviderError) {
    // CAPABILITY, UNKNOWN_PROVIDER, PROVIDER_ERROR, ACCESS_GATE, AUTH_REQUIRED (or INTERNAL)
    const { code, message } = toApiError(error);
    const detail = `${code} (${error.providerId} ${error.code}, retryable: ${error.retryable})`;
    if (code === 'INTERNAL') logger.error(`IPC ${channel} failed: ${detail}`, error);
    else logger.warn(`IPC ${channel} failed: ${detail}`);
    return { success: false, code, error: message };
  }

  logger.error(`IPC ${channel} failed:`, error);
  const message = error instanceof Error && error.message ? error.message : 'Unexpected error';
  return { success: false, code: 'INTERNAL', error: message };
}
