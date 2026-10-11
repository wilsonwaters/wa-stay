/**
 * Compile-time type equality, for pinning a zod schema to the TypeScript type it validates.
 *
 * `satisfies z.ZodType<T>` only checks one direction: a schema that forgets a new optional
 * field still satisfies it, and zod then strips that field from every parsed value without a
 * word. `assertTypeEquals` checks both directions, so the schema and the type cannot drift:
 *
 *   assertTypeEquals<z.input<typeof StayQuerySchema>, StayQuery>(true);
 *   assertTypeEquals<z.output<typeof StayQuerySchema>, StayQuery>(true);
 *
 * When the types differ the argument's type becomes `false` and `true` does not compile.
 */

/** `true` when `A` and `B` are identical (not merely assignable to each other), else `false`. */
export type Equals<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

/** Flattens an intersection into one object type, so it can be compared with `Equals`. */
export type Simplify<T> = { [K in keyof T]: T[K] };

/** Fails to compile unless `A` and `B` are identical. Does nothing at run time. */
export function assertTypeEquals<A, B>(_proof: Equals<A, B>): void {
  // Compile-time only.
}
