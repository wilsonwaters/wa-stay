/**
 * Building blocks for the IPC contract.
 *
 * A method definition pairs a channel with a zod `request` schema (one object payload, or
 * `z.void()`). Two phantom fields carry types only: `args`, the preload method's positional
 * parameters, and `response`, the `data` of a successful `APIResponse`. Their runtime value
 * is a placeholder (`{}`, or `undefined` for `void`) and is never read.
 */

import { z } from 'zod';
import type { APIResponse } from '../types/api.types';

export interface MethodDef<
  Req extends z.ZodType = z.ZodType,
  Args extends unknown[] = any[], // eslint-disable-line @typescript-eslint/no-explicit-any
  Res = unknown,
> {
  readonly channel: string;
  readonly request: Req;
  readonly args: Args;
  readonly response: Res;
}

export type Namespace = Record<string, MethodDef>;

/** What the preload sends: the schema's input type. */
export type RequestInput<D extends MethodDef> = z.input<D['request']>;
/** What a main-process handler receives: the parsed payload. */
export type RequestOutput<D extends MethodDef> = z.output<D['request']>;
export type ResponseOf<D extends MethodDef> = D['response'];

/** A `window.api` method as the renderer calls it. */
export type ApiMethod<D extends MethodDef> = (
  ...args: D['args']
) => Promise<APIResponse<D['response']>>;

export type NamespaceApi<N extends Namespace> = { [M in keyof N]: ApiMethod<N[M]> };

/** A positive integer row id. */
export const id = z.number().int().positive();

/** `{ id }`, the payload of every get/delete/activate-style method. */
export const idPayload = z.object({ id });
