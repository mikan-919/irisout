# Plan 001: Compile event handlers so signal writes trigger their update functions automatically

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 5495746..HEAD -- src/ test/ docs/`
> This plan was written against commit `5495746` **plus uncommitted working-tree
> changes** (the milestone 1–5 implementation). Before starting, confirm the
> "Current state" excerpts below match the live code; on a mismatch, treat it
> as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED (touches the compiler's render walk and codegen)
- **Depends on**: none
- **Category**: direction
- **Planned at**: commit `5495746` (+ uncommitted tree), 2026-07-03

## Why this matters

irisout compiles JSX into static HTML plus dedicated per-signal `update_*`
functions, but today **nothing in a compiled app can ever call them**. Updates
only happen because test code manually does `mod.count(5); mod.update_count()`.
`CONCEPT.v2.md` line 51 lists handlers (ハンドラ) as a discovery
responsibility, and its codegen example (lines 122–129) shows exactly the
target: a write to a signal followed by its dedicated update call. This plan
adds `onClick`-style handlers on host elements and compiles signal writes
inside them to `count(next); update_count();` — turning the compiler from a
codegen demo into something that produces interactive apps.

This is a **design spike**: the deliverable is a working minimal
implementation for always-present host elements, the tests that prove it, and
an ADR (`docs/adr/0002-event-handlers.md`) recording the decisions. Handlers
inside conditional branches or list items are explicitly out of scope.

## Current state

Repo facts:

- Language: plain JS (ESM), no TypeScript build. Package manager / runner:
  **bun** (mandated by `CLAUDE.md`). Tests: vitest via `bun run test`.
  **All code comments must be written in Japanese** (repo rule in `CLAUDE.md`);
  existing files follow this — match them. The ADR you write should also be in
  Japanese, modeled on `docs/adr/0001-first-milestone.md`.
- `src/compiler.js` (438 lines) — the whole pipeline: parse with
  `@babel/parser`, walk the root component's JSX, flatten/inline child
  components, build the signal→marker dependency graph, run the flattened
  script once on Node for discovery + initial HTML, then call
  `generateModule`.
- `src/codegen.js` — pure string assembly of the output ES module
  (`mountComponent()` + one `update_<name>()` per root signal).
- `src/runtime.js` — build-time `signal()`/`derived()` plus the tiny DOM glue
  (`mount`, `collectReactive`, …) that the generated module imports.
- `src/classify.js`, `src/template.js` — helpers; you should not need to
  change them.
- Tests live in `test/*.test.js`, use jsdom via `test/helpers.js`
  (`createContainer()` makes a real DOM container; `loadGenerated(code)`
  writes the generated module to a temp file and imports it).

### Where handlers are dropped today

`renderElement` (`src/compiler.js:322-354`) never reads attributes on
lowercase (host) tags — `<button onClick={...}>` compiles to `<button>` with
the handler silently discarded. Attributes are only read for **component**
tags, in `buildPropBindings` (`src/compiler.js:165-185`).

### The pieces you will reuse

`analyzeExpr` (`src/compiler.js:121-150`) takes a Babel path + instanceId and
returns `{ deps, rendered }`: the set of tracked declIds the expression reads,
and the source text with identifiers rewritten to their hygienic output names.
Handler expressions must go through it so cross-instance renames (`n` →
`n$1`) apply inside handler bodies too.

Tracked-binding resolution works like this (`src/compiler.js:124-134`): an
identifier's Babel scope binding is looked up, and
`declIdByKey.get(declKey(instanceId, binding.path.node.start))` maps it to a
declId if it is a tracked signal/derived/prop-alias. `declKind`
(`src/compiler.js:84`) says whether a declId is `'signal'` or `'derived'`.

Signals are read as `count()` and written as `count(next)` — the accessor in
`src/runtime.js:9-18` treats any call with ≥1 argument as a write.

The transitive closure derived→root-signal already exists:
`resolveToSignals` (`src/compiler.js:401-410`). `update_<name>` functions are
emitted per **root signal** output name (`src/codegen.js:37-39`), and function
declarations hoist, so `mountComponent` may reference them even though they
are emitted after it.

`mountComponent` today (`src/codegen.js:24-35`):

```js
outLines.push(
  `let __markers__, __anchors__${...};`,
  'export function mountComponent(container) {',
  '  ({ markers: __markers__, anchors: __anchors__ } = mount(container, __INITIAL_HTML__));',
  ...conditionalMarkers.map(...),
  ...listMarkers.flatMap(...),
  '}',
  ''
);
```

`mount()` (`src/runtime.js:29-35`) fills `__markers__` with every element
that has a `data-iris-id` attribute — so an element carrying a handler just
needs a `data-iris-id` to be findable at mount time, even if it has no
reactive text.

Elements with reactive text already get one:
`<${tagName} data-iris-id="${markerId}">` (`src/compiler.js:353`).

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Install | `bun install` | exit 0 |
| Tests   | `bun run test` | all pass (19 existing tests before this plan) |
| One file | `bunx vitest run test/handlers.test.js` | all pass |

## Scope

**In scope** (the only files you should modify/create):
- `src/compiler.js`
- `src/codegen.js`
- `test/handlers.test.js` (create)
- `docs/adr/0002-event-handlers.md` (create)
- `plans/README.md` (status row only)

**Out of scope** (do NOT touch, even though they look related):
- `src/runtime.js` — no runtime additions should be needed; if you think you
  need one, that is a STOP condition worth reporting.
- Handlers inside conditional branches or list item templates — branches are
  re-created via `innerHTML`-style insertion on swap, which would drop
  listeners; supporting that needs a re-wiring design that is deliberately
  deferred. **Throw a scope-limit error instead** (see Step 4).
- Non-handler host attributes (`class`, `value`, …) — a separate finding, not
  planned this round. Continue to ignore them.
- `src/classify.js`, `src/template.js`, existing tests.

## Git workflow

- Branch off the current branch: `advisor/001-event-handlers`.
- Commit style: English imperative summary, matching
  `git log` (e.g. "Implement ADR-0001 milestone 1-5: …"). One commit per
  logical unit is fine.
- Do NOT push or open a PR unless the operator instructed it.

## Design decisions to implement (and record in the ADR)

1. **Discovery is static, not build-time execution.** `CONCEPT.v2.md` puts
   handlers under runtime-execution discovery, but handlers never run at
   build time (they are event callbacks). In the current architecture they
   appear as JSX attributes, which is static-analysis territory. The ADR must
   record this refinement of the concept.
2. **Write detection**: inside a handler expression, a call to a tracked
   binding with ≥1 argument is a write. Resolve the callee identifier to its
   declId the same way `bareTrackedDeclId` does (`src/compiler.js:156-163`).
   Writes to a `'derived'` declId are a compile error. Collect the set of
   written declIds, resolve each through `resolveToSignals`, and emit one
   `update_<outputName>();` per distinct root signal after the handler body.
3. **Wiring at mount**: the compiler gives any host element carrying a
   handler a `data-iris-id` (reusing the existing marker-id counter), and
   `mountComponent` emits
   `__markers__.get("mN").addEventListener("click", __handler_mN_click);`
   lines. Handler functions are emitted as module-level consts:
   `const __handler_mN_click = <rewritten handler expr with update calls>;`
4. **Prop write-back comes for free**: a child writing to a `prop` alias
   resolves to the parent's signal declId (`src/compiler.js:207-210`), so the
   emitted update call is the parent signal's. Add a test proving it.

Target generated shape for a counter (illustrative, exact whitespace free):

```js
const __handler_m1_click = () => { count(count() + 1); update_count(); };

export function mountComponent(container) {
  ({ markers: __markers__, anchors: __anchors__ } = mount(container, __INITIAL_HTML__));
  __markers__.get("m1").addEventListener("click", __handler_m1_click);
}

export function update_count() { ... }
```

Note on ordering: `__handler_*` consts reference `update_*` functions — safe
because the consts are only *called* after mount, and function declarations
hoist. Keep `update_*` as function declarations (they already are).

## Steps

### Step 1: Collect handler attributes in the render walk

In `src/compiler.js`, when `renderElement` handles a **host** tag (the branch
after the `/^[A-Z]/` component check, lines 333–354), read
`elementPath.get('openingElement.attributes')`. For each attribute whose name
matches `/^on[A-Z]/` and whose value is a `JSXExpressionContainer`:

- Derive the DOM event name: `onClick` → `click` (strip `on`, lowercase).
- Run the handler expression through a new analysis (Step 2) to get
  `{ rendered, updateNames }`.
- Record a handler entry `{ markerId, eventName, rendered, updateNames }` in
  a new top-level `handlers` array (declare it next to `markers`,
  `src/compiler.js:88`).
- Ensure the element has a `data-iris-id`: if it already gets one via the
  reactive-text path (`src/compiler.js:352-353`), reuse that markerId; if
  not, allocate `m${markerCounter++}` and emit
  `data-iris-id="<id>"` on the opening tag. Do NOT register a marker object
  in `markers` for handler-only ids (markers drive `update_*` emission; a
  handler-only element has nothing to update).
- A handler attribute with a non-expression value (e.g. a string) is a
  compile error: `throw new Error('compile: handler ... must be an expression (scope limit)')`.

Handler attributes must be **excluded** from the baked HTML output — they are
not serialized (current behavior already serializes no attributes; keep it
that way apart from the added `data-iris-id`).

**Verify**: `bun run test` → all 19 existing tests still pass (handlers array
is additive; nothing consumes it yet).

### Step 2: Analyze handler expressions — reads renamed, writes mapped to update calls

Add a function `analyzeHandlerExpr(exprPath, instanceId)` in
`src/compiler.js` near `analyzeExpr`. It must:

1. Call `analyzeExpr(exprPath, instanceId)` to get the hygienic `rendered`
   text (reads and writes both reference the binding identifier, so the
   rename covers both).
2. Traverse the expression for `CallExpression`s whose callee is an
   identifier resolving (via scope binding start + `declIdByKey`, same
   pattern as `bareTrackedDeclId`, `src/compiler.js:156-163`) to a tracked
   declId, **with `arguments.length >= 1`** — these are writes.
   - If `declKind.get(declId) === 'derived'`: throw
     `compile: cannot write to derived "<name>"`.
   - Otherwise resolve to root signals with
     `resolveToSignals(declId, new Set())`. **Note**: `resolveToSignals` is
     currently declared *after* the render walk runs
     (`src/compiler.js:401-410`); function declarations hoist within the
     `compile` closure, so calling it from the walk is legal — but confirm it
     is a `function` declaration, not a const, before relying on that.
3. Return `{ rendered, updateNames }` where `updateNames` is a sorted array
   of distinct output names (`declOutputName.get(sigId)`) of written root
   signals.

Edge case that must work: the same call is both read and write —
`count(count() + 1)` — the outer call is a write, the inner a read; only one
`update_count` results.

**Verify**: `bun run test` → still all pass (nothing consumes the new
function yet). Temporarily `console.log` from a scratch script if you want to
sanity-check; remove it after.

### Step 3: Emit handler consts and wiring in codegen

In `src/codegen.js`:

- Extend the `generateModule({ ... })` signature to accept `handlers`
  (compiler passes it from `compile`, `src/compiler.js:435`).
- After the decl statements, emit one line per handler:
  `const __handler_<markerId>_<eventName> = <h.rendered wrapped so that update calls run after>;`
  The wrapping rule: if the handler expression is an arrow function with an
  expression body (the common case, e.g. `() => count(count() + 1)`), emit
  `(<params>) => { <body>; update_x(); }` — simplest is to not parse the
  rendered text again but emit
  `const __handler_... = (...__args) => { (<rendered>)(...__args); update_x(); };`
  i.e. call the user's function then the updates. This avoids re-parsing and
  works for any callable expression.
- Inside `mountComponent`, after the existing marker/anchor setup lines, emit
  per handler:
  `__markers__.get("<markerId>").addEventListener("<eventName>", __handler_<markerId>_<eventName>);`

**Verify**: `bun run test` → all existing tests pass (they contain no
handlers, so output is unchanged for them).

### Step 4: Guard the deferred cases

In `src/compiler.js`, throw a scope-limit error (matching the repo's existing
error style, e.g. `src/compiler.js:181`) when a handler attribute is found:

- inside a conditional branch (i.e. during `renderBranch`-initiated walks) —
  the swap logic re-creates branch DOM via `insertAfter`
  (`src/codegen.js:50`), which would drop listeners;
- inside a list item template — items are re-rendered via `innerHTML`
  (`src/codegen.js:67`).

Simplest mechanism: pass a boolean `inStructural` down through
`renderConditional`/`renderBranch` → `renderElement` → children, and check it
where Step 1 collects handlers. For lists no plumbing is needed:
`renderItemTemplate` lives in `src/classify.js` and list items never reach
`renderElement`; confirm that `on*` attributes in item templates are
rejected by the existing item-template restrictions — if they are silently
accepted into `innerSrc`, add the explicit throw in the compiler before
calling `renderItemTemplate`. Add a comment in Japanese naming the ceiling
and the upgrade path (listener re-wiring on branch swap / event delegation).

**Verify**: `bunx vitest run test/handlers.test.js` (after Step 5 the test
for this exists) — the scope-limit tests pass.

### Step 5: Tests

Create `test/handlers.test.js`, modeled structurally on
`test/counter.test.js` (imports, `createContainer`, `loadGenerated`,
Japanese header comment). Cases:

1. **Counter clicks**: source
   `export function Counter() { const count = signal(0); const doubled = derived(() => count() * 2); return <div><span>{doubled()}</span><button onClick={() => count(count() + 1)}>+</button></div>; }`
   — mount, `container.querySelector('button').dispatchEvent(new
   dom.window.Event('click'))` (jsdom: get the Event constructor from the
   container's `ownerDocument.defaultView`), assert the span text changed
   from `0` to `2` **without any manual `update_*` call**.
2. **Write-back through a prop alias**: parent passes `count()` bare to a
   child; the child's button writes to its prop; assert a parent-side marker
   updates. Follow the alias behavior documented at `src/compiler.js:17-20`.
3. **Two writes, one update each**: handler writes two different signals →
   both `update_*` calls present in generated code (assert on `code` string)
   and both markers update after one click.
4. **Write to derived throws** at compile time.
5. **Handler inside a conditional branch throws** a scope-limit error.

**Verify**: `bun run test` → all pass, count ≥ 24 (19 existing + ≥5 new).

### Step 6: Write ADR-0002

Create `docs/adr/0002-event-handlers.md` in Japanese, structured like
`docs/adr/0001-first-milestone.md` (ステータス / コンテキスト / 決定 /
未決定事項). Record decisions 1–4 from "Design decisions" above, plus the
deferred items (handlers in branches/list items, event delegation as the
likely upgrade path) under 未決定事項.

**Verify**: file exists; `bun run test` still green.

## Test plan

Covered by Step 5. Pattern file: `test/counter.test.js`. Verification:
`bun run test` → 0 failures, ≥5 new tests in `test/handlers.test.js`.

## Done criteria

ALL must hold:

- [ ] `bun run test` exits 0; `test/handlers.test.js` exists with ≥5 tests
- [ ] The generated code for the counter case contains
      `addEventListener("click"` and an `update_count()` call inside the
      emitted handler (assert in a test, not by eye)
- [ ] No `update_*` call sites require manual invocation in the new tests
      (grep the new test file: `grep -n "mod.update_" test/handlers.test.js`
      returns no matches)
- [ ] `git status` shows changes only in in-scope files
- [ ] `docs/adr/0002-event-handlers.md` exists (Japanese)
- [ ] Code comments added are in Japanese
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- The "Current state" excerpts don't match the live code (drift).
- You find yourself needing to modify `src/runtime.js` — the design intends
  zero runtime additions; needing one means the design assumption is wrong.
- `resolveToSignals` turns out not to be callable from the render walk
  (e.g. it was converted to a const arrow) — report rather than restructuring
  the compiler.
- Supporting the prop write-back test (case 2) appears to require new alias
  machinery — the plan assumes it works via the existing shared-declId
  mechanism; if not, that assumption is false.
- A step's verification fails twice after a reasonable fix attempt.

## Maintenance notes

- **Plan 002 (browser build target) depends on this plan** — its demo app is
  interactive.
- The `(...__args) => { (<rendered>)(...__args); update_x(); }` wrapper calls
  updates even when the handler didn't actually change the value (e.g. a
  conditional write). That is correct-but-wasteful; the text-marker update is
  idempotent. A reviewer should confirm no test depends on update *not*
  running.
- When conditional-branch handlers are eventually supported, the mount-time
  wiring must be re-run for remounted branches — that is the moment to
  consider container-level event delegation instead; the ADR's 未決定事項
  should already say this.
- Handlers that write a signal **not** read by any marker produce
  `update_` calls to functions that were never emitted (signalToMarkers only
  contains signals with markers, `src/codegen.js:37`). Step 2 must guard
  this: only emit update calls for signals present in `signalToMarkers`; if
  you hit it in testing, that is the cause.
