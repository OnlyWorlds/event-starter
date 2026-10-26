/**
 * The one door to OnlyWorlds. Everything the page reads goes through this file, so changing what
 * your tool reads means changing it here. It only reads; to write, see the SDK's README
 * (node_modules/@onlyworlds/sdk/README.md, "Reading and writing").
 */

import {
  OwApiError,
  OwNetworkError,
  OwV2Client,
  FIELD_SCHEMA,
  REVIEW_PROPOSED_LABEL,
  detectKeyKind,
  handsOnAsProposed,
  isDemoKey,
  isKnownOf,
  isRoomElement,
  type ElementType,
  type OwElement,
} from '@onlyworlds/sdk';

/**
 * The SDK's public demo key: reads the demo world Moppetopia, writes nothing, needs no PIN. It
 * is one key for everyone, with one budget of requests a minute, so its answers are kept for a
 * while in this tab (see `demoCache`).
 */
export const DEMO_KEY = '0000000001';
export const API_BASE = 'https://www.onlyworlds.com/api/v2';
/** Every request gets this long before the page gives up on it. */
export const REQUEST_LIMIT_MS = 15_000;
export const PAGE_SIZE = 100;
/** How long a demo answer is reused before it is asked again. */
export const DEMO_KEEP_MS = 10 * 60_000;
/** Your tool's name, sent with any write you add (lower case letters, digits, hyphens). */
export const TOOL_NAME = 'event-starter';

export type Element = OwElement & { type: ElementType; name?: string };

export interface WorldInfo {
  id: string;
  name: string;
  description: string;
  imageUrl: string;
}

export interface Page {
  elements: Element[];
  /** Room talk left out of this page (a parlor's lines, not the world's own story). */
  roomLeftOut: number;
  /** Where the next page starts, or null when this was the last. */
  next: string | null;
}

/** What the page says beside an element that is not plain world content. */
export type Mark = 'proposed' | 'hidden' | 'known-of' | null;

export const MARK_WORDS: Record<Exclude<Mark, null>, string> = {
  proposed: REVIEW_PROPOSED_LABEL,
  hidden: 'hidden from some readers',
  'known-of': 'known of: only part of it is shared',
};

/**
 * Proposed (suggested, not yet accepted by the world's keepers), hidden (kept from some readers;
 * you see it because your key reads as the owner), or known of (only some fields are shared with
 * this key). The SDK's readers decide where it has one.
 */
export function markOf(el: Element): Mark {
  if (handsOnAsProposed(el)) return 'proposed';
  const hidden = (el as { hidden?: unknown }).hidden;
  if (hidden !== undefined && hidden !== null && hidden !== false) return 'hidden';
  if (isKnownOf(el as { known_of?: unknown })) return 'known-of';
  return null;
}

/** Why a read did not work, in words for the person at the page. */
export class ReadProblem extends Error {}

/** A sentence for every failure, chosen by status and kind, never from the server's own text. */
export function problemLine(err: unknown, demo = false): string {
  if (err instanceof ReadProblem) return err.message;
  if (err instanceof OwApiError) {
    if (err.status === 401) return 'OnlyWorlds did not take that key. Check it on your world\'s page and paste it again.';
    if (err.status === 403) return 'That key cannot read this. It may need more access to the world.';
    if (err.status === 404 || err.status === 410) return 'That is not in this world, or this key cannot see it. A link from a world you read with your own key needs that key again after a reload.';
    if (err.status === 429 || err.status === 503) {
      const wait = err.retryAfter ? `Try again in ${Math.ceil(err.retryAfter)} seconds.` : 'Try again in a moment.';
      return demo
        ? `The shared demo key is busy right now. ${wait} Or read with your own world's read key.`
        : `OnlyWorlds asked this page to slow down. ${wait}`;
    }
    return 'OnlyWorlds could not answer that just now. Try again in a moment.';
  }
  const cause = err instanceof OwNetworkError ? (err.cause2 as { name?: string } | undefined) : (err as { name?: string } | undefined);
  if (cause?.name === 'TimeoutError' || cause?.name === 'AbortError') return 'OnlyWorlds took too long to answer. Try again in a moment.';
  if (err instanceof SyntaxError) return 'Something answered that was not OnlyWorlds (a network login page, perhaps). Check your connection and try again.';
  // A network failure, or a page address OnlyWorlds does not accept (see the README, "Where it runs").
  return 'OnlyWorlds could not be reached from this page: you may be offline, or this address is not one OnlyWorlds accepts.';
}

/** A fetch that gives up after REQUEST_LIMIT_MS, the answer's body included. */
function limitedFetch(base: typeof fetch): typeof fetch {
  return async (input, init) => {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(new DOMException('took too long', 'TimeoutError')), REQUEST_LIMIT_MS);
    try {
      const res = await base(input, { ...init, signal: ctl.signal, credentials: 'omit' });
      // The body is read inside the limit too; these statuses carry none.
      const body = [101, 204, 205, 304].includes(res.status) ? null : await res.arrayBuffer();
      return new Response(body, { status: res.status, statusText: res.statusText, headers: res.headers });
    } finally {
      clearTimeout(timer);
    }
  };
}

/**
 * The demo world's answers, kept in this tab for DEMO_KEEP_MS so a page reloading on every save
 * does not spend the shared key's budget. Demo data is public; nothing read with your own key is
 * ever kept.
 */
function demoCache(base: typeof fetch): typeof fetch {
  return async (input, init) => {
    const url = String(input instanceof Request ? input.url : input);
    const method = (init?.method ?? 'GET').toUpperCase();
    const slot = `demo:${url}`;
    if (method === 'GET') {
      try {
        const kept = JSON.parse(sessionStorage.getItem(slot) ?? 'null') as { at: number; body: string } | null;
        if (kept && Date.now() - kept.at < DEMO_KEEP_MS) return new Response(kept.body, { status: 200, headers: { 'Content-Type': 'application/json' } });
      } catch { /* no storage: ask */ }
    }
    const res = await base(input, init);
    if (method === 'GET' && res.status === 200) {
      try {
        sessionStorage.setItem(slot, JSON.stringify({ at: Date.now(), body: await res.clone().text() }));
      } catch { /* full or blocked: fine */ }
    }
    return res;
  };
}

/**
 * A key as pasted. This page only reads, so it takes a read key (ow_r_), the demo key, or an
 * older 10-digit key with its PIN. It refuses a write key, a seat secret and an account token:
 * anyone who opens a web page can read what it holds, and those can change a world or an account.
 */
export function checkKey(raw: string): { key: string; legacy: boolean } {
  const key = raw.trim();
  if (!key) throw new ReadProblem('Paste a key first.');
  if (isDemoKey(key)) return { key, legacy: false };
  const kind = detectKeyKind(key);
  if (kind === 'read') return { key, legacy: false };
  if (kind === 'legacy') return { key, legacy: true };
  if (kind === 'write' || kind === 'account' || key.startsWith('ow_s_')) {
    throw new ReadProblem('This page only reads, so it takes a read key. Make one (it starts with ow_r_) on your world\'s page on onlyworlds.com.');
  }
  throw new ReadProblem('That does not look like an OnlyWorlds key. A world\'s read key starts with ow_r_.');
}

/** An element id as keel makes them, checked before it goes into a request's address. */
export function isElementId(id: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
}

export class World {
  private readonly client: OwV2Client;
  readonly demo: boolean;

  /** `pin` only for an older 10-digit key (checkKey says `legacy`). */
  constructor(key: string, pin?: string, fetchImpl: typeof fetch = (...a) => fetch(...a)) {
    this.demo = isDemoKey(key);
    const limited = limitedFetch(fetchImpl);
    this.client = new OwV2Client({
      apiKey: key,
      apiPin: pin || undefined,
      baseUrl: API_BASE,
      client: TOOL_NAME,
      pageSize: PAGE_SIZE,
      fetch: this.demo ? demoCache(limited) : limited,
    });
  }

  async info(): Promise<WorldInfo> {
    const w = await this.client.getWorld();
    return { id: w.id, name: w.name || 'Untitled world', description: w.description ?? '', imageUrl: w.image_url ?? '' };
  }

  /** One page of a type, as the server lists them. Room talk is left out and counted. */
  async page(type: ElementType, cursor?: string): Promise<Page> {
    const p = await this.client.list(type, cursor ? { limit: PAGE_SIZE, cursor } : { limit: PAGE_SIZE });
    const all = p.data.map((e) => ({ ...e, type }) as Element);
    const elements = all.filter((e) => !isRoomElement(e));
    const next = p.has_more && p.next_cursor && p.next_cursor !== cursor ? p.next_cursor : null;
    return { elements, roomLeftOut: all.length - elements.length, next };
  }

  /** One element, its links named by the server in the same answer. */
  async element(type: ElementType, id: string): Promise<Element> {
    if (!isElementId(id)) throw new ReadProblem('That address does not name an element.');
    const expand = linkFields(type).map((l) => l.field);
    return { ...(await this.client.get(type, id, expand.length ? { expand } : undefined)), type } as Element;
  }
}

/** The link fields of a type, with the type each points at. */
export function linkFields(type: ElementType): Array<{ field: string; target: ElementType }> {
  const schema = FIELD_SCHEMA[type] as Record<string, { type: string; target?: string }>;
  return Object.entries(schema)
    .filter(([, s]) => (s.type === 'single_link' || s.type === 'multi_link') && s.target)
    .map(([field, s]) => ({ field, target: s.target as ElementType }));
}

/** One linked element as an expanded answer gives it: a name when the key may see it. */
export interface Linked {
  id: string;
  name: string | null;
}

/**
 * What a link field holds: ids, or the stubs `expand` puts in their place. An id the server did
 * not expand is one this key cannot see; it has no name here.
 */
export function linkedIn(value: unknown): Linked[] {
  const items = Array.isArray(value) ? value : value === null || value === undefined || value === '' ? [] : [value];
  const out: Linked[] = [];
  for (const v of items) {
    if (typeof v === 'string' && v) out.push({ id: v, name: null });
    else if (v && typeof v === 'object' && typeof (v as { id?: unknown }).id === 'string') {
      const n = (v as { name?: unknown }).name;
      out.push({ id: (v as { id: string }).id, name: typeof n === 'string' && n ? n : 'Untitled' });
    }
  }
  return out;
}

/** Every filled link of an element, with the type it points at. */
export function linksOf(el: Element): Array<{ field: string; type: ElementType; items: Linked[] }> {
  return linkFields(el.type)
    .map(({ field, target }) => ({ field, type: target, items: linkedIn(el[field as keyof Element]) }))
    .filter((l) => l.items.length > 0);
}

/** A picture only from OnlyWorlds' own picture host; any other address is never asked for. */
export function pictureUrl(raw: unknown): string | null {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  try {
    const u = new URL(raw);
    return u.protocol === 'https:' && u.hostname === 'media.onlyworlds.com' ? u.href : null;
  } catch {
    return null;
  }
}
