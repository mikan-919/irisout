# Plan 002: Emit a browser-runnable build — static index.html plus one app.js

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 5495746..HEAD -- src/ test/ scripts/ examples/`
> This plan was written against commit `5495746` **plus uncommitted
> working-tree changes**, and it assumes **Plan 001 (event handlers) has
> landed**. Confirm `test/handlers.test.js` exists and passes before
> starting; if it doesn't, STOP — this plan's demo is inert without it.

## Status

- **Priority**: P2
- **Effort**: S–M
- **Risk**: LOW (additive: a build script and a hydrate path; compiler core untouched)
- **Depends on**: plans/001-event-handlers-and-write-triggered-updates.md
- **Category**: direction
- **Planned at**: commit `5495746` (+ uncommitted tree), 2026-07-03

## Why this matters

`CONCEPT.v2.md` line 9 states the product promise: 「ブラウザに届くのは、
静的 HTML と専用の更新コードだけであるべきです」 (the browser should receive
only static HTML and dedicated update code). Today nothing ships to a
browser at all: generated modules hardcode
`import ... from '../src/runtime.js'` (`src/codegen.js:13`) and the only
consumers are jsdom tests and `examples/demo.mjs`. Worse, the current
`mount()` sets the initial HTML via `innerHTML` at runtime
(`src/runtime.js:30`) — the HTML arrives inside JavaScript, not as static
HTML, which contradicts the concept's central claim. This plan is the
validation spike: a build script that turns one `.jsx` file into a
`dist/index.html` (initial HTML **baked into the document**) plus one
bundled `app.js` that hydrates it.

## Current state

Repo facts:

- Runner/bundler: **bun** (mandated by `CLAUDE.md`); `Bun.build` is the
  bundler — no new dependencies allowed for bundling. Tests: vitest via
  `bun run test`. **All code comments in Japanese** (repo rule); match
  existing files. `package.json` currently has a single script:
  `"test": "vitest run"`.
- `src/compiler.js` — `compile(source)` returns
  `{ code, initialHtml, markers, signalToMarkers, declName }`
  (`src/compiler.js:437`). `code` is a complete ES module source string;
  `initialHtml` is the real initial HTML obtained by executing the flattened
  component at build time (`src/compiler.js:422-425`).
- `src/codegen.js:13` — the generated module's first line:

  ```js
  outLines.push("import { signal, derived, mount, collectReactive, forgetReactive, insertAfter, htmlToNode } from '../src/runtime.js';", '');
  ```

- `src/runtime.js:29-35` — `mount`:

  ```js
  export function mount(container, html) {
    container.innerHTML = html;
    const markers = new Map();
    const anchors = new Map();
    collectReactive(container, markers, anchors);
    return { markers, anchors };
  }
  ```

  Note the shape: setting innerHTML and discovering markers are already
  separate concerns — a hydrate path is `mount` minus the innerHTML line.
- `src/codegen.js:26-33` — `mountComponent(container)` calls
  `mount(container, __INITIAL_HTML__)` and then initializes conditional
  state (`__cond_*`) and list key-maps (`__list_*`) by walking the live DOM.
  All of that initialization reads the DOM *after* markers exist, so it
  works identically over server-baked HTML.
- `test/helpers.js:15-20` — `loadGenerated` currently patches the hardcoded
  import path by string replacement:

  ```js
  export async function loadGenerated(code) {
    const runtimePath = JSON.stringify(path.join(process.cwd(), 'src/runtime.js'));
    const file = path.join(tmpdir(), `irisout-${Date.now()}-${Math.random()}.mjs`);
    writeFileSync(file, code.replace("'../src/runtime.js'", runtimePath));
    return import(file);
  }
  ```

- `examples/todo.jsx` — existing example (list + conditional, **no
  handlers**). `examples/demo.mjs` — Node/jsdom driver script.
- Design constraint to honor, from `CONCEPT.v2.md` lines 15-16:
  「可能な限り HTML を生成する。可能な限りランタイムの抽象化を排除する。」
  The build output must put the initial HTML in the `.html` file, not in the
  JS bundle.

## Design decisions to implement (and record in the ADR)

1. **Hydrate, don't mount, in the browser.** Add
   `hydrateComponent(container)` to the generated module: identical to
   `mountComponent` except it calls a new runtime `hydrate(container)`
   (= `mount` without the `innerHTML` assignment). The build bakes
   `initialHtml` into `index.html` inside the container div;
   `hydrateComponent` only discovers markers/anchors and attaches handlers.
   Keep `mountComponent` unchanged — tests and jsdom demos still use it.
   This costs ~5 lines and is the concept's whole point; shipping
   `__INITIAL_HTML__` inside `app.js` **and** in the HTML would double-ship,
   so the generated module must be built such that the bundler can drop
   `__INITIAL_HTML__` when only `hydrateComponent` is imported (it will:
   `__INITIAL_HTML__` is a module-level const referenced only by
   `mountComponent`, and `Bun.build` tree-shakes unused exports of the
   entry's imports — verify in Step 4's size check; if it is not dropped,
   record that as a known issue in the ADR rather than fighting it).
2. **Bundling strategy: one `app.js`, runtime inlined.** The generated
   module imports `'../src/runtime.js'`; the build script writes the module
   to a temp dir **as a sibling layout that preserves that relative path**
   (i.e. write to `<tmp>/gen/module.mjs` and copy nothing — instead point
   the import at the real absolute runtime path the same way
   `test/helpers.js:16-18` does), then runs `Bun.build` with the module as
   entry, `format: 'esm'`, `minify: false` (readable output is a stated
   goal — the concept says the ideal output is what a human would hand-write).
3. **The build entry auto-hydrates.** The build script generates a tiny
   entry file:

   ```js
   import { hydrateComponent } from './module.mjs';
   hydrateComponent(document.getElementById('app'));
   ```

   and bundles *that*, so `index.html` needs only
   `<script type="module" src="./app.js"></script>` and no inline script.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Install | `bun install` | exit 0 |
| Tests   | `bun run test` | all pass (≥24 after Plan 001) |
| Build (after this plan) | `bun run build examples/counter.jsx` | exit 0, writes `dist/index.html` + `dist/app.js` |

## Scope

**In scope** (the only files you should modify/create):
- `scripts/build.mjs` (create)
- `src/runtime.js` — add `hydrate` only
- `src/codegen.js` — emit `hydrateComponent` alongside `mountComponent`
- `examples/counter.jsx` (create — interactive demo)
- `test/build.test.js` (create)
- `package.json` — add the `build` script line only
- `plans/README.md` (status row only)
- `.gitignore` — add `dist/` if not present

**Out of scope** (do NOT touch):
- `src/compiler.js`, `src/classify.js`, `src/template.js` — no compiler
  changes are needed; needing one is a STOP condition.
- A dev server, watch mode, multi-file input, CSS handling — all future.
- `examples/todo.jsx` / `examples/demo.mjs` — leave as-is.
- Minification, hashing, production niceties.

## Git workflow

- Branch: `advisor/002-browser-build` (off the branch where Plan 001 landed).
- Commit style: English imperative summary, matching `git log`.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Add `hydrate` to the runtime

In `src/runtime.js`, next to `mount` (`src/runtime.js:29-35`), add:

```js
// 既にドキュメントに焼き込まれた初期 HTML の上でマーカー/アンカーを発見する
// だけの mount:innerHTML を書かない。ビルド出力 (scripts/build.mjs) が
// index.html に静的 HTML を埋め込み、ブラウザ側はこれで水和する。
export function hydrate(container) {
  const markers = new Map();
  const anchors = new Map();
  collectReactive(container, markers, anchors);
  return { markers, anchors };
}
```

(Comment in Japanese, as shown — adjust wording freely, keep it Japanese.)

**Verify**: `bun run test` → all pass (nothing consumes it yet).

### Step 2: Emit `hydrateComponent` in codegen

In `src/codegen.js`:

- Add `hydrate` to the runtime import line (line 13).
- The body of `mountComponent` (lines 26-33) initializes `__cond_*` and
  `__list_*` after obtaining `{ markers, anchors }`. Factor those setup
  lines so they are emitted **twice**: once inside `mountComponent` (with
  `mount(container, __INITIAL_HTML__)`) and once inside a new exported
  `hydrateComponent(container)` (with `hydrate(container)`). String-level
  duplication via a shared array of setup lines is fine — this is a string
  assembler, keep it boring.

**Verify**: `bun run test` → all pass. Then a spot check: add a temporary
assertion in `test/build.test.js` later (Step 5) — no manual checks needed
here beyond green tests.

### Step 3: Create the interactive example

Create `examples/counter.jsx` (uses only features that exist after
Plan 001 — text markers, derived, a click handler; **no** conditionals or
lists needed):

```jsx
export function Counter() {
  const count = signal(0);
  const doubled = derived(() => count() * 2);
  return (
    <div>
      <p>count: {count()} / doubled: {doubled()}</p>
      <button onClick={() => count(count() + 1)}>increment</button>
    </div>
  );
}
```

**Verify**: `bun run test` → still green (the example isn't compiled by
tests yet).

### Step 4: Write `scripts/build.mjs`

Node/bun script, comments in Japanese. Behavior:

1. `const input = process.argv[2]` — path to a `.jsx` file; error with a
   usage line if missing.
2. Read the source, call `compile(source)` from `../src/compiler.js`.
3. In a temp dir (use `fs.mkdtempSync(path.join(os.tmpdir(), 'irisout-'))`):
   - write `module.mjs` = `code` with the `'../src/runtime.js'` import
     rewritten to the absolute runtime path — same one-line string
     replacement as `test/helpers.js:18`;
   - write `entry.mjs` = the auto-hydrate entry from Design decision 3.
4. `await Bun.build({ entrypoints: [entry], outdir: 'dist', naming: 'app.js', format: 'esm', target: 'browser' })`
   — check `result.success`, print `result.logs` and exit 1 on failure.
5. Write `dist/index.html`:

   ```html
   <!doctype html>
   <html>
   <head><meta charset="utf-8"><title>irisout app</title></head>
   <body>
   <div id="app"><!-- initialHtml inserted here --></div>
   <script type="module" src="./app.js"></script>
   </body>
   </html>
   ```

   with `initialHtml` from `compile()` embedded verbatim inside the div.
6. Print the output file paths and their sizes.

Add to `package.json` scripts: `"build": "bun scripts/build.mjs"`.
Add `dist/` to `.gitignore` if missing (current `.gitignore` is 48 bytes —
check it).

**Verify**: `bun run build examples/counter.jsx` → exit 0;
`ls dist` shows `index.html` and `app.js`;
`grep -c "count:" dist/index.html` → ≥1 (baked HTML present);
`grep -c "__INITIAL_HTML__" dist/app.js` → expected 0 (tree-shaken; if 1,
note it in the ADR as a known issue per Design decision 1 — do not fight it).

### Step 5: Smoke test the built output under jsdom

Create `test/build.test.js`, modeled on `test/counter.test.js` / using
`JSDOM` directly (see `examples/demo.mjs` for the pattern). Cases:

1. **Hydrate over baked HTML**: compile the counter source in-test, take
   `initialHtml`, create a JSDOM whose `#app` div already contains
   `initialHtml`, load the generated module via `loadGenerated`, call
   `mod.hydrateComponent(container)`, dispatch a click on the button, assert
   the text updated. This proves hydrate + handlers work without
   `mountComponent` ever writing innerHTML.
2. **Build script end-to-end**: run
   `Bun.spawnSync(['bun', 'scripts/build.mjs', 'examples/counter.jsx'])`
   (or `node:child_process` `execFileSync` — either is fine under bun),
   assert exit code 0 and that `dist/index.html` contains the counter markup
   and `dist/app.js` contains `hydrateComponent` or its minified equivalent
   (`addEventListener` is a stable grep target).

**Verify**: `bun run test` → all pass, including the 2 new tests.

### Step 6: Manual browser check + ADR note

Serve `dist/` (`bunx serve dist` or `python3 -m http.server -d dist`) and
click the button in a real browser. This is the one human-judgment step; if
you cannot open a browser in your environment, state that in your report and
rely on the jsdom test.

Append a short section to `docs/adr/0002-event-handlers.md` **or** create
`docs/adr/0003-browser-build.md` (prefer the latter if decisions 1–3 above
feel substantial enough — they are; keep it in Japanese, modeled on
ADR-0001) recording: hydrate-vs-mount, the single-bundle decision, and the
double-ship status of `__INITIAL_HTML__` observed in Step 4.

**Verify**: file exists; `bun run test` green.

## Test plan

Covered by Step 5: `test/build.test.js`, 2 tests (hydrate-over-baked-HTML,
build-script end-to-end). Pattern files: `test/counter.test.js`,
`examples/demo.mjs`. Verification: `bun run test` → 0 failures.

## Done criteria

ALL must hold:

- [ ] `bun run test` exits 0; `test/build.test.js` exists with ≥2 tests
- [ ] `bun run build examples/counter.jsx` exits 0 and produces
      `dist/index.html` + `dist/app.js`
- [ ] `dist/index.html` contains the baked initial HTML
      (`grep "count:" dist/index.html` matches)
- [ ] `dist/` is git-ignored (`git status` clean of dist after a build)
- [ ] `git status` shows changes only in in-scope files
- [ ] An ADR records the hydrate/bundle decisions (Japanese)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- Plan 001 has not landed (`test/handlers.test.js` missing or failing).
- The "Current state" excerpts don't match the live code (drift).
- You find yourself needing to change `src/compiler.js` — this plan is
  designed to be additive to codegen/runtime only.
- `Bun.build` is unavailable in the environment (e.g. tests forced onto
  plain Node) — report; do not substitute a new bundler dependency.
- Hydration produces different behavior than mount in case 1 of the tests
  (e.g. conditional `__cond_*` init reads wrong state) — that would falsify
  the assumption that `mountComponent`'s setup lines work identically over
  baked HTML; report the diff rather than patching around it.

## Maintenance notes

- When list/conditional apps get handlers (deferred from Plan 001), the
  hydrate path needs no change — but the manual browser check should be
  repeated with such an app.
- If `__INITIAL_HTML__` is not tree-shaken out of `app.js` (Step 4 grep),
  the eventual fix is emitting mount and hydrate into separate generated
  modules — a codegen restructure; deferred deliberately.
- Future dev-server / watch work builds on `scripts/build.mjs`; keep it a
  pure argv→files function so it can be imported.
- A reviewer should scrutinize: HTML-escaping of `initialHtml` when embedded
  in `index.html` (it is raw markup by design — but confirm no `</div>`
  breakage with content containing comments/anchors, which the conditional
  markers do contain: `<!--m2-->`).
