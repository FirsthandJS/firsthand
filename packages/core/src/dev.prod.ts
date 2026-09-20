/** Production stub for `dev.ts`. Aliased in by the build; see `dev.ts`. */

export function devWarn(_message: string): void {
  /* stripped in production */
}

export function reportUncaught(error: unknown): void {
  queueMicrotask(() => {
    throw error;
  });
}

export function setStrictReactivity(_on: boolean): void {
  /* stripped in production */
}

export function devEnterSetup(_id: string): void {
  /* stripped in production */
}

export function devExitSetup(): void {
  /* stripped in production */
}

export function devEnterSnapshot(): void {
  /* stripped in production */
}

export function devExitSnapshot(): void {
  /* stripped in production */
}

export function devCheckSetupRead(): void {
  /* stripped in production */
}

export function devLabel(_target: object, _kind: string, _name: string): void {
  /* stripped in production */
}

export function devCause(_dep: object): void {
  /* stripped in production */
}

export function devRoot(_owner: object): void {
  /* stripped in production */
}

export function devRunning(_effect: object | null): void {
  /* stripped in production */
}
