/**
 * Bit flags shared by every reactive node.
 *
 * All three node kinds (signal, computed, effect) use one object shape so that
 * every access site in the graph code stays monomorphic (ADR-0002).
 */

/** The node memoises a value produced by `fn`: it is a computed. */
export const MUTABLE = 1 << 0;
/** The node is scheduled when invalidated: it is an effect. */
export const WATCHING = 1 << 1;
/** A direct dependency definitely changed. The node must re-evaluate. */
export const DIRTY = 1 << 2;
/** A transitive dependency may have changed. Resolve by checking deps. */
export const PENDING = 1 << 3;
/** The node is currently in the flush queue. */
export const QUEUED = 1 << 4;
/** The node has been disposed; it must never run again. */
export const DISPOSED = 1 << 5;
/** A computed has produced a value at least once. */
export const HAS_VALUE = 1 << 6;

/** `DIRTY | PENDING`: the node is not known to be up to date. */
export const STALE = DIRTY | PENDING;
