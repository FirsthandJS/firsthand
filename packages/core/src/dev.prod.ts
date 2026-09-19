/** Production stub for `dev.ts`. Aliased in by the build; see `dev.ts`. */

export function devWarn(_message: string): void {
  /* stripped in production */
}

export function reportUncaught(error: unknown): void {
  queueMicrotask(() => {
    throw error;
  });
}
