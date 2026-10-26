import { describe, expect, it, vi } from 'vitest';
import { DEMO_KEY, REQUEST_LIMIT_MS, World, checkKey, isElementId, linksOf, markOf, pictureUrl, problemLine, type Element } from './world';

type Call = { url: string; headers: Headers };

/** A fake OnlyWorlds: answers by path, records what was asked. */
function fakeServer(answer: (path: string, url: URL) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const f = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input instanceof Request ? input.url : input));
    calls.push({ url: url.href, headers: new Headers(init?.headers) });
    return answer(url.pathname, url);
  }) as typeof fetch;
  return { f, calls };
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });

const READ_KEY = 'ow_r_' + 'a'.repeat(40);
const ID = '0695db83-c6e8-7ab6-8000-bf4b7d713f37';

describe('checkKey', () => {
  it('takes a read key (trimmed), the demo key and an older 10-digit key', () => {
    expect(checkKey(`  ${READ_KEY}\n`)).toEqual({ key: READ_KEY, legacy: false });
    expect(checkKey(DEMO_KEY)).toEqual({ key: DEMO_KEY, legacy: false });
    expect(checkKey('1234567890').legacy).toBe(true);
  });
  it('refuses a write key, a seat secret and an account token, since the page only reads', () => {
    for (const k of ['ow_w_' + 'b'.repeat(40), 'ow_s_' + 'c'.repeat(40), 'ow_a_' + 'd'.repeat(40)]) {
      expect(() => checkKey(k)).toThrow(/only reads/);
    }
  });
  it('refuses an empty field and something that is no key', () => {
    expect(() => checkKey('   ')).toThrow(/Paste a key/);
    expect(() => checkKey('hello')).toThrow(/does not look like/);
  });
});

describe('markOf', () => {
  const base = { id: 'x', type: 'character', name: 'A' } as unknown as Element;
  it('names a proposal, a hidden element and a known-of one, and leaves the rest plain', () => {
    expect(markOf({ ...base, x_review_proposed: { by: 'm' } } as unknown as Element)).toBe('proposed');
    expect(markOf({ ...base, hidden: true } as unknown as Element)).toBe('hidden');
    expect(markOf({ ...base, known_of: true } as unknown as Element)).toBe('known-of');
    expect(markOf({ ...base, hidden: false } as unknown as Element)).toBe(null);
    expect(markOf(base)).toBe(null);
  });
});

describe('World', () => {
  it('sends the key as a header, never in the address', async () => {
    const { f, calls } = fakeServer(() => json({ id: 'w1', name: 'Moppetopia' }));
    await new World(READ_KEY, undefined, f).info();
    expect(calls[0].headers.get('API-Key')).toBe(READ_KEY);
    expect(calls.every((c) => !c.url.includes(READ_KEY))).toBe(true);
  });

  it('gives each listed element its type, leaves room talk out and counts it, and stops on a repeated cursor', async () => {
    const { f } = fakeServer(() => json({
      data: [{ id: 'n1', name: 'Plot' }, { id: 'n2', name: 'hi all', supertype: 'Message', x_room_of: 'w1' }],
      has_more: true, next_cursor: 'same',
    }));
    const w = new World(READ_KEY, undefined, f);
    const first = await w.page('narrative');
    expect(first.elements.map((e) => e.id)).toEqual(['n1']);
    expect(first.elements[0].type).toBe('narrative');
    expect(first.roomLeftOut).toBe(1);
    expect(first.next).toBe('same');
    expect((await w.page('narrative', 'same')).next).toBe(null);
  });

  it('asks for an element with its links expanded, and refuses an id that is not one', async () => {
    const { f, calls } = fakeServer(() => json({ id: ID, name: 'Navy', objects: [{ id: 'o1', name: 'Ship' }] }));
    const w = new World(READ_KEY, undefined, f);
    await w.element('institution', ID);
    expect(new URL(calls[0].url).searchParams.get('expand')).toContain('objects');
    await expect(w.element('institution', '../world')).rejects.toThrow(/does not name an element/);
    expect(calls).toHaveLength(1);
  });

  it('keeps the demo world\'s answers for a while, and never another key\'s', async () => {
    const store = new Map<string, string>();
    vi.stubGlobal('sessionStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) });
    try {
      const demo = fakeServer(() => json({ id: 'w', name: 'Moppetopia' }));
      await new World(DEMO_KEY, undefined, demo.f).info();
      await new World(DEMO_KEY, undefined, demo.f).info();
      expect(demo.calls).toHaveLength(1);
      const mine = fakeServer(() => json({ id: 'w2', name: 'Mine' }));
      await new World(READ_KEY, undefined, mine.f).info();
      await new World(READ_KEY, undefined, mine.f).info();
      expect(mine.calls).toHaveLength(2);
      expect([...store.values()].join('')).not.toContain('Mine');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('gives up on a request that never answers, and says it took too long', async () => {
    vi.useFakeTimers();
    try {
      const never = ((_: unknown, init?: RequestInit) => new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal!.reason));
      })) as typeof fetch;
      const caught = new World(READ_KEY, undefined, never).info().catch((e: unknown) => e);
      await vi.advanceTimersByTimeAsync(REQUEST_LIMIT_MS + 10);
      expect(problemLine(await caught)).toMatch(/took too long/);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('problemLine', () => {
  const failWith = async (status: number, headers: Record<string, string> = {}, key = READ_KEY) => {
    const { f } = fakeServer(() => json({ error: { type: 'api_error', code: 'x', message: 'SERVER WORDS <b>' } }, status, headers));
    const w = new World(key, undefined, f);
    return w.info().catch((e: unknown) => problemLine(e, w.demo));
  };
  it('says each failure in plain words, never the server\'s text', async () => {
    expect(await failWith(401)).toMatch(/did not take that key/);
    expect(await failWith(404)).toMatch(/not in this world/);
    expect(await failWith(429, { 'Retry-After': '7' })).toMatch(/slow down.*7 seconds/);
    expect(await failWith(500)).toMatch(/could not answer/);
    for (const s of [401, 403, 404, 429, 500, 503]) expect(await failWith(s)).not.toMatch(/SERVER WORDS/);
  });
  it('a busy demo key says it is shared and points at your own key', async () => {
    vi.stubGlobal('sessionStorage', { getItem: () => null, setItem: () => {} });
    try {
      expect(await failWith(429, { 'Retry-After': '3' }, DEMO_KEY)).toMatch(/shared demo key is busy.*3 seconds.*your own/);
    } finally {
      vi.unstubAllGlobals();
    }
  });
  it('a network failure, and an answer that is not OnlyWorlds\'s, each get their sentence', async () => {
    const down = (async () => { throw new TypeError('Failed to fetch'); }) as typeof fetch;
    expect(await new World(READ_KEY, undefined, down).info().catch((e: unknown) => problemLine(e))).toMatch(/could not be reached/);
    const portal = (async () => new Response('<html>wifi login</html>', { status: 200, headers: { 'Content-Type': 'text/html' } })) as typeof fetch;
    expect(await new World(READ_KEY, undefined, portal).info().catch((e: unknown) => problemLine(e))).toMatch(/not OnlyWorlds/);
  });
  it('anything else still gets a sentence', () => {
    expect(problemLine(new Error('weird'))).toMatch(/could not be reached/);
    expect(problemLine(undefined)).toMatch(/could not be reached/);
  });
});

describe('links and pictures', () => {
  it('reads expanded stubs by name, and an id left unexpanded as one this key cannot see', () => {
    const el = { id: 'c', type: 'character', location: { id: 'l1', name: 'Port' }, friends: ['c2', ''], rivals: [], species: null } as unknown as Element;
    const links = linksOf(el);
    expect(links.find((l) => l.field === 'location')).toEqual({ field: 'location', type: 'location', items: [{ id: 'l1', name: 'Port' }] });
    expect(links.find((l) => l.field === 'friends')).toEqual({ field: 'friends', type: 'character', items: [{ id: 'c2', name: null }] });
    expect(links.some((l) => l.field === 'rivals' || l.field === 'species')).toBe(false);
  });
  it('loads pictures only from OnlyWorlds\' picture host', () => {
    expect(pictureUrl('https://media.onlyworlds.com/a.webp')).toBe('https://media.onlyworlds.com/a.webp');
    for (const u of ['https://tracker.example/p.png', 'http://media.onlyworlds.com/a.webp', 'javascript:alert(1)', '', 42]) expect(pictureUrl(u)).toBe(null);
  });
  it('checks an id before it goes into an address', () => {
    expect(isElementId(ID)).toBe(true);
    for (const bad of ['../world', 'x', `${ID}/`, '']) expect(isElementId(bad)).toBe(false);
  });
});
