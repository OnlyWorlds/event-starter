/**
 * The page: a world's elements, one type at a time, and one element's fields. It opens on the
 * demo world, or on your own world when you build with a read key in VITE_OW_READ_KEY (see the
 * README). "Your world" reads another world with a key that stays in this tab's memory only: a
 * reload forgets it. Addresses: `#/<type>` and `#/<type>/<id>`.
 */

import './style.css';
import { ELEMENT_SECTIONS, ELEMENT_TYPES, FIELD_SCHEMA, fieldLabel, getElementLabel, type ElementType } from '@onlyworlds/sdk';
import { DEMO_KEY, MARK_WORDS, World, checkKey, linksOf, markOf, pictureUrl, problemLine, type Element, type WorldInfo } from './world';
import { h, clear } from './dom';

const root = document.getElementById('app')!;

/** A read key built into the page (VITE_OW_READ_KEY), or the demo key. */
const builtIn = (() => {
  const raw = (import.meta.env.VITE_OW_READ_KEY as string | undefined)?.trim();
  if (!raw) return null;
  try {
    const k = checkKey(raw);
    return k.legacy ? null : k.key;
  } catch {
    console.warn('VITE_OW_READ_KEY is not a read key (ow_r_), so the page opens on the demo world.');
    return null;
  }
})();
const startKey = builtIn ?? DEMO_KEY;

let world = new World(startKey);
let onStart = true;
let info: WorldInfo | null = null;
let worldProblem = '';

/** What the list shows: one type, the pages read so far, and where the next starts. */
let list: { type: ElementType; elements: Element[]; roomLeftOut: number; next: string | null; problem: string; loading: boolean } | null = null;
/** The open element, or the problem reading it. */
let open: { id: string; el: Element | null; problem: string } | null = null;

/** Each read takes a number; an answer whose number is no longer the latest is dropped. */
let listRead = 0;
let elementRead = 0;
let worldRead = 0;

function isType(t: string): t is ElementType {
  return (ELEMENT_TYPES as string[]).includes(t);
}

function route(): { type: ElementType; id: string | null } {
  const [, t = '', id = ''] = location.hash.split('/');
  return { type: isType(t) ? t : 'character', id: id || null };
}

async function readWorld(): Promise<void> {
  const n = ++worldRead;
  info = null;
  worldProblem = '';
  render();
  try {
    const got = await world.info();
    if (n !== worldRead) return;
    info = got;
  } catch (err) {
    if (n !== worldRead) return;
    worldProblem = problemLine(err, world.demo);
  }
  render();
}

async function readList(type: ElementType, more = false): Promise<void> {
  const n = ++listRead;
  const before = more && list?.type === type ? list : null;
  list = { type, elements: before?.elements ?? [], roomLeftOut: before?.roomLeftOut ?? 0, next: before?.next ?? null, problem: '', loading: true };
  render();
  try {
    const page = await world.page(type, before?.next ?? undefined);
    if (n !== listRead) return;
    list = { type, elements: [...list.elements, ...page.elements], roomLeftOut: list.roomLeftOut + page.roomLeftOut, next: page.next, problem: '', loading: false };
  } catch (err) {
    if (n !== listRead) return;
    list = { ...list, problem: problemLine(err, world.demo), loading: false };
  }
  render();
}

async function readElement(type: ElementType, id: string): Promise<void> {
  const n = ++elementRead;
  open = { id, el: null, problem: '' };
  render();
  try {
    const el = await world.element(type, id);
    if (n !== elementRead) return;
    open = { id, el, problem: '' };
  } catch (err) {
    if (n !== elementRead) return;
    open = { id, el: null, problem: problemLine(err, world.demo) };
  }
  render();
}

/** Follow the address: read the list when the type changed, the element when one is named. */
function follow(): void {
  const r = route();
  if (!list || list.type !== r.type) void readList(r.type);
  if (r.id) {
    if (open?.id !== r.id) void readElement(r.type, r.id);
  } else {
    ++elementRead;
    open = null;
    render();
  }
}

function restart(): void {
  list = null;
  open = null;
  ++elementRead;
  void readWorld();
  if (route().id) location.hash = `#/${route().type}`;
  else follow();
}

let keyProblem = '';

/**
 * The header is built once, so a key being typed survives every redraw; render() fills its
 * slots. The inputs have no name, so even a form sent without this page's script carries nothing.
 */
const titleSlot = h('h1', {});
const sourceChip = h('span', { class: 'chip' });
const worldPicture = h('img', { class: 'wpic', alt: '', referrerpolicy: 'no-referrer', hidden: true });
const descSlot = h('p', { class: 'desc' });
const worldProblemSlot = h('p', { class: 'problem', role: 'alert' });
const keyProblemSlot = h('p', { class: 'problem', role: 'alert' });
const keyInput = h('input', { id: 'key', type: 'text', placeholder: 'ow_r_…', spellcheck: 'false', autocomplete: 'off', autocapitalize: 'off' });
const pinInput = h('input', { id: 'pin', type: 'password', inputmode: 'numeric', autocomplete: 'off' });
const pinLabel = h('label', { for: 'pin', hidden: true }, 'PIN (an older 10-digit key reads with its PIN)', pinInput);
keyInput.addEventListener('input', () => {
  let legacy = false;
  try { legacy = checkKey(keyInput.value).legacy; } catch { /* not a key yet */ }
  pinLabel.hidden = !legacy;
});

function useKey(): void {
  let checked: { key: string; legacy: boolean };
  try {
    checked = checkKey(keyInput.value);
  } catch (err) {
    keyProblem = problemLine(err);
    render();
    return;
  }
  // The key lives in this World and nowhere else: not in storage, not in the address.
  world = new World(checked.key, checked.legacy ? pinInput.value.trim() || undefined : undefined);
  keyInput.value = '';
  pinInput.value = '';
  pinLabel.hidden = true;
  onStart = false;
  keyProblem = '';
  yours.open = false;
  restart();
}

function backToStart(): void {
  world = new World(startKey);
  onStart = true;
  restart();
}

const keyForm = h(
  'form',
  { class: 'key', autocomplete: 'off', onsubmit: (e: Event) => { e.preventDefault(); useKey(); } },
  h('label', { for: 'key' }, 'World key', keyInput),
  pinLabel,
  h('button', { class: 'btn', type: 'submit' }, 'Read this world'),
  keyProblemSlot,
  h('p', { class: 'hint' }, 'Use a read key (it starts with ow_r_) from your world\'s page on onlyworlds.com. This page only reads, and the key stays in this tab: a reload forgets it.'),
);
const yours = h('details', { class: 'yours' }, h('summary', {}, 'Your world'), keyForm);
const back = h('button', { class: 'btn quiet', type: 'button', onclick: () => backToStart() }, builtIn ? 'Back to the built-in world' : 'Back to the demo world');
const panes = h('div', { class: 'panes' });
root.append(h('header', { class: 'top' }, h('div', { class: 'title' }, worldPicture, titleSlot, sourceChip), descSlot, worldProblemSlot, yours, back), panes);

function renderHeader(): void {
  titleSlot.textContent = info?.name ?? (worldProblem ? 'No world' : 'Reading…');
  sourceChip.textContent = !onStart ? 'Your key' : builtIn ? 'Built-in key' : 'Demo world';
  const pic = pictureUrl(info?.imageUrl);
  if (pic && worldPicture.getAttribute('src') !== pic) worldPicture.src = pic;
  worldPicture.hidden = !pic;
  descSlot.textContent = info?.description ?? '';
  descSlot.hidden = !info?.description;
  worldProblemSlot.textContent = worldProblem;
  worldProblemSlot.hidden = !worldProblem;
  keyProblemSlot.textContent = keyProblem;
  keyProblemSlot.hidden = !keyProblem;
  if (keyProblem) yours.open = true;
  yours.hidden = !onStart;
  back.hidden = onStart;
}

function listPane(): HTMLElement {
  const r = route();
  const select = h('select', { 'aria-label': 'Element type', onchange: (e: Event) => { location.hash = `#/${(e.target as HTMLSelectElement).value}`; } },
    ...ELEMENT_TYPES.map((t) => h('option', { value: t, selected: t === r.type }, getElementLabel(t))));
  const items = (list?.elements ?? []).map((el) => {
    const mark = markOf(el);
    return h('li', {},
      h('a', { href: `#/${el.type}/${el.id}`, class: el.id === r.id ? 'on' : undefined, 'aria-current': el.id === r.id ? 'true' : undefined },
        h('span', {}, el.name || 'Untitled'),
        mark ? h('span', { class: `mark ${mark}` }, MARK_WORDS[mark]) : null));
  });
  const word = list ? getElementLabel(list.type).toLowerCase() : '';
  return h('nav', { class: 'pane list', 'aria-label': 'Elements' },
    select,
    list?.problem ? h('p', { class: 'problem', role: 'alert' }, list.problem) : null,
    !list || (list.loading && !items.length) ? h('p', { class: 'muted' }, 'Reading…') : null,
    list && !list.loading && !list.problem && !items.length ? h('p', { class: 'muted' }, `No ${word} in this world${list.roomLeftOut ? ' outside its room talk' : ''}.`) : null,
    items.length ? h('ul', {}, items) : null,
    list?.roomLeftOut ? h('p', { class: 'muted small' }, `${list.roomLeftOut} ${list.roomLeftOut === 1 ? 'line' : 'lines'} of room talk left out: a parlor's conversation, not the world's own story.`) : null,
    list?.next ? h('button', { class: 'btn', type: 'button', disabled: list.loading, onclick: () => void readList(list!.type, true) }, list.loading ? 'Reading…' : 'Load more') : null,
  );
}

function textOf(v: unknown): string | null {
  if (typeof v === 'string') return v.trim() ? v : null;
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  return null;
}

function elementPane(): HTMLElement {
  if (!open) return h('main', { class: 'pane element' }, h('p', { class: 'muted' }, 'Pick an element to read it.'));
  const el = open.el;
  if (!el) {
    return h('main', { class: 'pane element' },
      open.problem ? h('p', { class: 'problem', role: 'alert' }, open.problem) : h('p', { class: 'muted' }, 'Reading…'));
  }
  const schema = FIELD_SCHEMA[el.type] as Record<string, { type: string }>;
  const links = new Map(linksOf(el).map((l) => [l.field, l]));
  const rows: HTMLElement[] = [];
  const sections = [...ELEMENT_SECTIONS[el.type]].sort((a, b) => a.order - b.order);
  for (const s of sections) {
    for (const f of s.fields) {
      if (f === 'name' || f === 'description' || f === 'image_url' || !schema[f]) continue;
      const link = links.get(f);
      if (link) {
        rows.push(h('div', { class: 'row' }, h('dt', {}, fieldLabel(f)), h('dd', { class: 'links' },
          ...link.items.map((it) => it.name !== null
            ? h('a', { href: `#/${link.type}/${it.id}` }, it.name)
            : h('span', { class: 'muted' }, `a ${link.type} this key cannot see`)))));
      } else if (schema[f].type !== 'single_link' && schema[f].type !== 'multi_link') {
        const t = textOf(el[f as keyof Element]);
        if (t !== null) rows.push(h('div', { class: 'row' }, h('dt', {}, fieldLabel(f)), h('dd', {}, t)));
      }
    }
  }
  const mark = markOf(el);
  const pic = pictureUrl(el.image_url);
  const typeWord = el.type.charAt(0).toUpperCase() + el.type.slice(1);
  const kind = [typeWord, textOf(el.supertype), textOf(el.subtype)].filter(Boolean).join(' · ');
  return h('main', { class: 'pane element' },
    pic ? h('img', { class: 'epic', src: pic, alt: '', referrerpolicy: 'no-referrer', loading: 'lazy' }) : null,
    h('h2', {}, el.name || 'Untitled'),
    h('p', { class: 'kind' }, kind, mark ? h('span', { class: `mark ${mark}` }, MARK_WORDS[mark]) : null),
    textOf(el.description) ? h('p', { class: 'desc' }, String(el.description)) : null,
    rows.length ? h('dl', {}, rows) : h('p', { class: 'muted' }, 'No other fields are filled in.'),
  );
}

function render(): void {
  renderHeader();
  clear(panes, listPane(), elementPane());
}

window.addEventListener('hashchange', follow);
void readWorld();
follow();
