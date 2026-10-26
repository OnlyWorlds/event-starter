/**
 * The one way this page makes DOM. Text goes in through text nodes only, so a quote or a tag in
 * a world's names and descriptions stays text: never build markup from world data with innerHTML.
 */

type Child = Node | string | number | null | undefined | false;

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, unknown> | null = null,
  ...children: Array<Child | Child[]>
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs ?? {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') {
      el.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
    } else if (k === 'style') {
      // The host's policy allows no inline style (public/_headers, style-src 'self'): use a class.
      throw new Error(`h(${tag}): no style attribute, use a class`);
    } else if (k === 'class') {
      el.className = String(v);
    } else if (k === 'value' || k === 'disabled' || k === 'checked' || k === 'hidden' || k === 'selected') {
      (el as unknown as Record<string, unknown>)[k] = v;
    } else {
      el.setAttribute(k, v === true ? '' : String(v));
    }
  }
  append(el, children);
  return el;
}

function append(el: Element, children: Array<Child | Child[]>): void {
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

export function clear(el: Element, ...children: Array<Child | Child[]>): void {
  el.replaceChildren();
  append(el, children);
}
