// Tiny element builder. Text only ever reaches the page as textContent or an attribute value, never as markup:
// the strings shown here come from Apple Music pages and are untrusted.

type Child = Node | string | null | false | undefined;

export interface Props {
  class?: string;
  /** Plain text content. */
  text?: string;
  attrs?: Record<string, string | undefined>;
  on?: Partial<{ [K in keyof HTMLElementEventMap]: (event: HTMLElementEventMap[K]) => void }>;
}

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Props = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (props.class) node.className = props.class;
  if (props.text !== undefined) node.textContent = props.text;
  for (const [name, value] of Object.entries(props.attrs ?? {})) {
    if (value !== undefined) node.setAttribute(name, value);
  }
  for (const [type, handler] of Object.entries(props.on ?? {})) {
    node.addEventListener(type, handler as EventListener);
  }
  for (const child of children) {
    if (child === null || child === false || child === undefined) continue;
    node.append(child);
  }
  return node;
}
