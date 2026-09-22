/**
 * The Firsthand TSX transform (ADR-0009).
 *
 * Static markup becomes one `<template>` per shape, created once and cloned per
 * instance. Every dynamic expression becomes a thunk handed to a specialised
 * DOM part, and the runtime decides by observation whether an effect needs to
 * be retained. The compiler never tries to decide statically whether an
 * expression is reactive — that question is undecidable in general, and being
 * wrong about it means silently missing updates.
 *
 * The transform emits calls against the published protocol in
 * `@firsthandjs/dom/internal` and has no privileged access to the runtime.
 *
 * | Module          | What it decides                                     |
 * | --------------- | --------------------------------------------------- |
 * | `plugin.ts`     | which pass runs when                                |
 * | `components.ts` | what a `component(...)` call gains                  |
 * | `strict.ts`     | what will not compile at all (ADR-0019)             |
 * | `props.ts`      | destructured props as live reads (ADR-0005)         |
 * | `runs.ts`       | which function a piece of markup belongs to         |
 * | `lists.ts`      | `.map` with a key as a keyed list part              |
 * | `jsx.ts`        | component call, server markup, or template          |
 * | `template.ts`   | the browser's `<template>` and the parts into it    |
 * | `markup.ts`     | the server's string and the holes in it             |
 * | `attributes.ts` | one attribute, inlined or written                   |
 */

export { default } from './plugin.js';

export type { FirsthandPluginOptions } from './options.js';
