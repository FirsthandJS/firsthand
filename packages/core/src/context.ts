import { Cell, defaultEquals } from './cell.js';
import { getOwner, type ContextRecord, type Owner } from './core.js';
import { FirsthandContextError } from './errors.js';
import { devWarn } from './dev.js';
import type { ReadonlyCell } from './types.js';

/** Marks which owner a context record belongs to, so records are created once. */
const RECORD_OWNER: unique symbol = Symbol('firsthand.ctx');

type ContextInternals<T> = {
  readonly id: symbol;
  readonly description: string;
  readonly hasDefault: boolean;
  readonly defaultValue: T | undefined;
  /** Lazily created constant cell handed to consumers with no provider. */
  fallback: Cell | undefined;
};

declare const BRAND: unique symbol;

/**
 * A typed context token. Its identity is the token object itself.
 *
 * The phantom member makes the token invariant in `T`, so a `Context<Theme>`
 * cannot be passed where a `Context<User>` is expected.
 */
export type Context<T> = {
  readonly id: symbol;
  readonly description: string;
  readonly [BRAND]?: (value: T) => T;
};

/**
 * Creates a context token.
 *
 * Without a default value, reading the context with no provider above is a
 * typed error rather than a silent `undefined`.
 */
export function createContext<T>(): Context<T>;
// The presence of the argument is the distinction: it decides whether reading
// without a provider throws or returns a default.
// eslint-disable-next-line @typescript-eslint/unified-signatures
export function createContext<T>(defaultValue: T, description?: string): Context<T>;
export function createContext<T>(defaultValue?: T, description?: string): Context<T> {
  const label = description ?? 'context';
  const token: ContextInternals<T> = {
    id: Symbol(label),
    description: label,
    // `arguments.length` is what distinguishes "no default" from "a default of
    // undefined"; the overloads above are the type-level version of the same.

    hasDefault: arguments.length > 0,
    defaultValue,
    fallback: undefined,
  };
  return token;
}

/**
 * Provides a value for `context` to the current scope and everything created
 * under it afterwards.
 *
 * Pass a cell to keep the provider reactive; pass a plain value to provide a
 * constant. Call `provide` before creating the children that should see it.
 */
export function provide<T>(
  context: Context<T>,
  // `NoInfer` keeps the token as the inference site. Without it the value
  // decides `T`, and passing a `Context<Theme>` a `{ mode: 'dark' }` infers
  // `{ mode: string }` and then rejects the token for not matching.
  value: NoInfer<T> | ReadonlyCell<NoInfer<T>>,
): void {
  const owner = getOwner();
  if (owner === null) {
    devWarn(`provide() for ${context.description} was called outside any scope; it has no effect.`);
    return;
  }
  const cell =
    value instanceof Cell ? value : new Cell(0, value, undefined, defaultEquals(undefined));
  recordFor(owner)[context.id] = cell;
}

/**
 * Resolves `context` once, at setup time, and returns the provider's cell.
 *
 * Steady-state cost of `theme.value` afterwards is exactly one signal read: no
 * tree walk, no DOM traversal, no map lookup (ADR-0008). Because resolution
 * follows the owner tree, it is unaffected by portals and shadow roots.
 */
export function useContext<T>(context: Context<T>): ReadonlyCell<T> {
  const owner = getOwner();
  const record = owner !== null ? owner.ctx : null;
  const found = record !== null ? record[context.id] : undefined;
  if (found !== undefined) {
    return found as ReadonlyCell<T>;
  }
  const token = context as unknown as ContextInternals<T>;
  if (!token.hasDefault) {
    throw new FirsthandContextError(token.description);
  }
  return (token.fallback ??= new Cell(
    0,
    token.defaultValue,
    undefined,
    defaultEquals(undefined),
  )) as unknown as ReadonlyCell<T>;
}

/** Returns the owner's own context record, creating it on first `provide`. */
function recordFor(owner: Owner): ContextRecord {
  const inherited = owner.ctx;
  if (inherited !== null && (inherited as Record<symbol, unknown>)[RECORD_OWNER] === owner) {
    return inherited;
  }
  const record = (
    inherited !== null ? Object.create(inherited) : Object.create(null)
  ) as ContextRecord;
  record[RECORD_OWNER] = owner;
  owner.ctx = record;
  return record;
}
