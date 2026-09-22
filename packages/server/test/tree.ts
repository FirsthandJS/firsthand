/**
 * A tree, written down, so that two of them can be compared.
 *
 * What matters is what the browser ends up with, which is not the same as the
 * bytes: the client writes `node.checked = true` and leaves no attribute, and
 * the server writes `checked=""` and lets the parser produce the property.
 * Both arrive at a checked input. So the properties the DOM layer writes as
 * properties are read back as properties, and the attributes that stand for
 * them are left out of the attribute list.
 */

/** Written as properties by the DOM layer, so read back as properties here. */
const PROPERTIES = [
  'checked',
  'disabled',
  'multiple',
  'muted',
  'readOnly',
  'selected',
  'autofocus',
  'autoplay',
  'controls',
  'loop',
  'open',
  'required',
  'value',
];

const PROPERTY_ATTRIBUTES = new Set(PROPERTIES.map((name) => name.toLowerCase()));

export type TreeOptions = {
  /**
   * Joins runs of adjacent text.
   *
   * The client builds `Hello, ` and `Ada` as two text nodes; a parser reads
   * the same markup as one. That is the parser's doing rather than a
   * difference in the tree, and it is gone after hydration, which splits the
   * run — so markup is compared with runs joined and a hydrated tree is
   * compared node for node.
   */
  readonly joinText?: boolean;
};

export function canonical(node: Node, options: TreeOptions = {}): string {
  const element = node as Element;
  const attributes = [...element.attributes]
    .filter((one) => !PROPERTY_ATTRIBUTES.has(one.name))
    .map((one) =>
      one.name === 'style'
        ? // Written the same way, stored differently: the client assigns
          // `cssText` and the CSSOM hands back its own spelling, while a
          // parsed attribute keeps the source.
          `style=${JSON.stringify((element as unknown as ElementCSSInlineStyle).style.cssText)}`
        : `${one.name}=${JSON.stringify(one.value)}`,
    )
    .sort();
  const properties = PROPERTIES.filter((name) => name in element).map(
    (name) =>
      `.${name}=${JSON.stringify(String((element as unknown as Record<string, unknown>)[name]))}`,
  );
  const head = [...attributes, ...properties].join(' ');
  return `<${element.tagName.toLowerCase()} ${head}>${inside(element, options)}</>`;
}

/** The children of a node, as one string. */
export function inside(host: Node, options: TreeOptions = {}): string {
  let out = '';
  let text = '';
  for (const node of host.childNodes) {
    if (node.nodeType === 3) {
      if (options.joinText === true) {
        text += node.nodeValue ?? '';
        continue;
      }
      out += JSON.stringify(node.nodeValue ?? '');
      continue;
    }
    if (node.nodeType === 8 && node.nodeValue === '[') {
      // Where a dynamic child begins. It exists so hydration can find the
      // region, and hydration removes it again, so it is not part of either
      // tree being compared.
      continue;
    }
    if (text !== '') {
      out += JSON.stringify(text);
      text = '';
    }
    out += node.nodeType === 8 ? '<!>' : canonical(node, options);
  }
  return text === '' ? out : out + JSON.stringify(text);
}
