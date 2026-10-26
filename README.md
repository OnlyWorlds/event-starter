# World Starter

A small web page that reads an [OnlyWorlds](https://www.onlyworlds.com) world: its elements, one type at a time, and one element's fields with its links. Start your own tool from it: the setup is done, so the first hour goes to your idea.

It is plain TypeScript with [Vite](https://vite.dev) and the [OnlyWorlds SDK](https://www.npmjs.com/package/@onlyworlds/sdk), with no framework. It only reads.

## Start

You need [Node.js](https://nodejs.org) 22.12 or newer.

```bash
npm install
npm run dev
```

Open http://localhost:5173. The page already reads a real world: Moppetopia, the public demo world, through the SDK's demo key. No account is needed.

## Read your own world

1. On [onlyworlds.com](https://www.onlyworlds.com), open your world's page and make a **read key** (it starts with `ow_r_`). A new key is shown once, so copy it then.
2. In the page, open **Your world**, paste the key and press Enter.

The page keeps the key only in that tab's memory: a reload goes back to the demo world. To open on your world every time, build the key in. Make a file named `.env.local` beside this README:

```
VITE_OW_READ_KEY=ow_r_your_key_here
```

Only ever a read key. Anyone who opens a web page can read every key in it, and a read key can only read. The build refuses a write key (`ow_w_`), a seat secret (`ow_s_`) or an account token (`ow_a_`). `.env.local` is not committed.

## Make it yours

- `src/world.ts` is the one file that talks to OnlyWorlds. Add new reads here. Set `TOOL_NAME` to your tool's name.
- `src/main.ts` is the page. `src/style.css` holds the look; its colours are at the top.
- The page's title is in `index.html`, and its security policy in `public/_headers`. When your page calls another site or shows pictures from one, add that host there.
- Building with an AI assistant? It should read `AGENTS.md` first.
- To write to a world, see the SDK's README ("Reading and writing", "Your own world"). Writes need a write key and a PIN, which never go in a web page: use a small server or a script.

## Where it runs

OnlyWorlds answers a web page only from addresses it knows. This page works from:

- your own computer (`http://localhost:<any port>`)
- Cloudflare Pages (`*.pages.dev`), GitHub Pages (`*.github.io`), Netlify, Vercel, Render, Firebase and the other common free hosts

It does not work from GitHub Codespaces, another device on your network (`http://192.168…`) or a domain of your own. There the page says it could not reach OnlyWorlds.

## Put it online

The build is a folder of static files (`npm run build` makes `dist/`). Either of these works.

**Cloudflare Pages**: in the Cloudflare dashboard, Workers & Pages > Create > Pages > Connect to Git, and pick your repository. Build command `npm run build`, output directory `dist`. To build your key in, add `VITE_OW_READ_KEY` under the project's environment variables. Every push to your main branch then goes live at `https://<project>.pages.dev`.

**GitHub Pages**: on a free account the repository must be public.

1. Settings > Pages > Source: **GitHub Actions**.
2. Settings > Secrets and variables > Actions > Variables: add `PAGES_ON` with the value `true` (and `VITE_OW_READ_KEY` to build your key in).
3. Actions > Deploy to GitHub Pages > Run workflow. From then on every push to `main` deploys, to `https://<you>.github.io/<repository>/`.

## Checks

```bash
npm test                                  # the units, no network
npx playwright install chromium firefox   # once, for the walks
npm run walk                              # the page in two browsers with OnlyWorlds played: no account, no network
npm run live                              # your build in two browsers against the real OnlyWorlds
OW_KEY=ow_r_... npm run live              # and a world read through "Your world" with that key
PAGE_URL=https://<project>.pages.dev/ node walk/live.mjs   # the same checks on your page once it is online
```

`npm run walk` always opens on its own played demo world and builds into `walk/.dist`, so a key in `.env.local` and your `dist/` are left alone. `npm run live` builds `dist/` as you would deploy it: with a key in `.env.local` it checks that the page opens on your world.

## About this starter

OnlyWorlds made this starter for its workshops and anyone else building on world data. The code is MIT (`LICENSE`). What you build on it is yours: rename it, change the look, and license your own code as you choose. Questions and fixes to the starter itself: [github.com/OnlyWorlds/event-starter](https://github.com/OnlyWorlds/event-starter).
