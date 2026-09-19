/**
 * React components as ordinary TSX elements.
 *
 * ```tsx
 * import '@firsthandjs/react/auto';
 * import Button from '@mui/material/Button';
 *
 * <Button variant="contained" onClick={save}>Save</Button>
 * ```
 *
 * Importing this module once, at startup, does two things: it installs an
 * adapter in `@firsthandjs/dom` for element types that are not Firsthand components,
 * and it adds React's component type to the JSX namespace so TSX accepts one.
 * Both are opt-in and both live here, in the package that already depends on
 * React — `@firsthandjs/dom` knows only that *an* adapter exists.
 *
 * What it costs, honestly:
 *
 * - It is still `fromReact` underneath, so it is still a React root per
 *   instance. Nothing about the bridge gets cheaper by writing it this way.
 * - The adapter is looked up once per component *type* and cached, so one
 *   bridge serves every `<Button/>` in the application.
 * - `children` are typed as React's `ReactNode`, because that is what the
 *   component's own props say. Firsthand children still work at runtime — they
 *   are inserted into an element Firsthand keeps owning — but a Firsthand component
 *   as a child does not type-check. Use `fromReact(Component)`, whose
 *   `children` are `View`, where you need that.
 * - `host` and `class` are not available: they are `fromReact`'s own props,
 *   and a direct element passes everything to React.
 */
import { setComponentAdapter, type Component } from '@firsthandjs/dom';
import type { ComponentType } from 'react';
import { fromReact } from './index.js';

setComponentAdapter((target): Component<never> =>
  fromReact(target as unknown as ComponentType<object>),
);

declare global {
  namespace JSX {
    interface ForeignElementTypes {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      react: ComponentType<any>;
    }
  }
}
