# Plan 005: TypeScript rewrite, Milestone 2 — event handlers + write-triggered updates

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 0155e85..HEAD -- src/ test/`
> This plan was written against commit `0155e85` ("Rewrite compiler in
> TypeScript; land Milestone 1..."). If `src/compiler.ts`,
> `src/compiler/render.ts`, `src/compiler/analyze.ts`, `src/compiler/state.ts`,
> or `src/codegen.ts` changed since then, compare the "Current state"
> excerpts below against the live code before proceeding; on a mismatch,
> treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Depends on**: 004 (TypeScript rewrite Milestone 1 — signal/derived +
  text markers, DONE at commit `0155e85`)
- **Category**: feature (unblocks: without this, `update_*()` can never be
  triggered in production — M1's pipeline is a closed loop with no way in)
- **Planned at**: commit `0155e85`, 2026-07-05

## Why this matters

Milestone 1 (plan 004) proved the compile → codegen pipeline end to end, but
generated components have no way to actually get written to: `update_count()`
exists and works, but nothing in the generated module ever calls it in a real
app, because there is no handler wiring. This mirrors ADR-0002's original
milestone split (event handlers were deliberately deferred from milestone 1)
and plan 001 in the legacy JS codebase, which this plan re-implements under
ADR-0006's "no runtime wrapper in output" codegen strategy.

**The one genuinely new piece of logic, not a mechanical port**: legacy's
write-detection heuristic (`analyzeHandlerExpr` in
`legacy/src/compiler/analyze.js:47-66`) classified "a call with ≥1 argument to
a tracked identifier" as a write, then spliced the user's *original* handler
expression (renamed) into a generated wrapper that re-invokes it
(`(${rendered})(...__args)`) — this worked because `count` was a real,
callable signal accessor both in the handler source and in the shipped
runtime. Under ADR-0006, `count` is a plain variable in the output, so
`count(count() + 1)` (the *source*, unchanged — authoring surface still uses
the explicit `signal()`/`derived()` API) must compile to `count = count + 1;`
in the *output* — an assignment, not a re-invoked call. This is a mechanical,
per-call-site rewrite of an *already-classified* call (the write-detection
heuristic itself doesn't change), not a general assignment-grammar inference
problem — see ADR-0006's roadmap note and `session/000_ts-rewrite-kickoff-and-m1.md`.

## Current state

- `src/compiler/state.ts:38-58` — `CompilerState` has no `handlers` field
  (removed from the legacy shape since M1 has no handler support yet):

  ```ts
  export interface CompilerState {
    source: string;
    declIdByKey: Map<string, DeclId>;
    declKind: Map<DeclId, DeclKind>;
    declOutputName: Map<DeclId, string>;
    derivedDeps: Map<DeclId, Set<DeclId>>;
    derivedRecompute: Map<DeclId, string>;
    usedOutputNames: Set<string>;
    markers: Marker[];
    markerDeps: Map<MarkerId, Set<DeclId>>;
    markerCounter: number;
    instanceCounter: number;
  }
  ```

- `src/compiler/analyze.ts` has `analyzeExpr` (reads only — rewrites `count()`
  to bare `count` for output, keeps `count()` for `sourceRendered`) and
  `bareTrackedDeclId`, but no `analyzeHandlerExpr` equivalent.

- `src/compiler/render.ts:210-214` — `renderElement` currently throws on
  *any* attribute:

  ```ts
  if (elementPath.node.openingElement.attributes.length > 0) {
    throw new Error(
      "compile: host element attributes are not supported yet (scope limit)",
    );
  }
  ```

  This must become handler-aware: `on[A-Z]...` attributes get collected as
  handlers; any *other* attribute still throws (that's plan 007's job, not
  this one).

- `src/codegen.ts` (75 lines) has no handler emission and no
  `mountComponent`'s `addEventListener` wiring — `mountComponent` today only
  does `({ markers: __markers__ } = mount(container, __INITIAL_HTML__));`.

- `src/compiler.ts:88-130` builds `signalToMarkers` from `ctx.markerDeps`
  only; there is no equivalent of legacy's post-pass
  (`legacy/src/compiler.js:139-145`) that converts each handler's
  `writeDeclIds` into `updateNames` (filtered to signals that actually have a
  marker, since `update_*` only exists for those).

- `src/runtime.ts` has `mount()` but no DOM event-listener glue beyond what
  `mount()` already returns (`{ markers }` — no listener attachment helper
  needed; `addEventListener` is called directly in codegen-emitted code, same
  as legacy).

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|----------------------|
| Typecheck | `bun run typecheck` | no errors |
| Tests | `bun run test` | all pass (5 today; ≥N after, see Test plan) |
| Full check | `bun run check-all` | biome clean, typecheck clean, tests pass |

## Scope

**In scope**:
- `src/compiler/state.ts` — add `handlers` field to `CompilerState`.
- `src/compiler/analyze.ts` — add `analyzeHandlerExpr`.
- `src/compiler/render.ts` — `renderElement` distinguishes `on[A-Z]` attrs
  from other attrs; collect handlers via `analyzeHandlerExpr` on the
  handler's arrow-function *body* (not the whole arrow function — see Step 3
  for why); register into `ctx.handlers` alongside whichever marker the
  element already needs (reuse existing marker if the element also has
  reactive text; mint a new one otherwise — mirrors legacy's
  `registerHandlers` pattern).
- `src/codegen.ts` — emit `__handler_<markerId>_<eventName>` wrapper
  functions (preserving the user's original handler parameter list) and wire
  `addEventListener` calls into `mountComponent`.
- `src/compiler.ts` — after `signalToMarkers` is built, convert each
  handler's `writeDeclIds` to `updateNames` (filtered + sorted, matching
  legacy's `legacy/src/compiler.js:139-145`).
- `test/handlers.test.ts` (create) — real dispatched DOM click events via
  jsdom, using `createContainer`/`loadGenerated` from `test/helpers.ts`. This
  is also where the "write, then observe the DOM update" test deferred from
  plan 004's `test/counter.test.ts` finally lands (see that file's comment).

**Out of scope** (do NOT touch, even though related):
- Handlers inside conditional branches or list-item templates — still a
  scope-limit error (that's plan 008 / ADR-0005's factory closures).
- Non-handler host attributes (`class`, `id`, etc.) — plan 007.
- Multi-parameter or destructured handler parameters beyond a simple
  identifier list — if you hit one, throw a scope-limit error rather than
  guessing (see STOP conditions).
- Adopting quix's build-time dependency-tracker approach (see
  `plans/README.md`'s "Direction findings" section) — this plan keeps the
  existing static-AST write-detection heuristic unchanged; that's a separate
  decision to make before/during plan 008, not here.

## Steps

### Step 1: Add `handlers` to `CompilerState`

In `src/compiler/state.ts`, add to the `Marker`-adjacent types:

```ts
export interface HandlerDecl {
  markerId: MarkerId;
  eventName: string;
  rendered: string;
  writeDeclIds: Set<DeclId>;
}
```

Add `handlers: HandlerDecl[];` to `CompilerState` and `handlers: []` to
`createCompilerState`'s return value.

**Verify**: `bun run typecheck` — will fail until Steps 2–4 also land (other
files don't populate/consume it yet); that's expected, keep going.

### Step 2: `analyzeHandlerExpr` in `src/compiler/analyze.ts`

Mirror `analyzeExpr`'s traversal, but special-case a call with ≥1 argument to
a tracked identifier as a **write**, rewriting `name(expr)` into `name = expr`
via two edits (prefix `name = `, drop the closing paren) rather than one
blob-replacement edit — this leaves `expr`'s own nested reads to be rewritten
by the *same* traversal pass, since `path.traverse` still visits identifiers
inside the argument:

```ts
export interface HandlerAnalysis {
  rendered: string;
  writeDeclIds: Set<DeclId>;
}

export function analyzeHandlerExpr(
  ctx: CompilerState,
  exprPath: NodePath<t.Expression>,
  instanceId: number,
): HandlerAnalysis {
  const writeDeclIds = new Set<DeclId>();
  const edits: Edit[] = [];

  const visit = (idPath: NodePath<t.Identifier>) => {
    const id = resolveDeclId(ctx, idPath, instanceId);
    if (!id) return;
    const outputName = ctx.declOutputName.get(id);
    if (!outputName) return;

    const parent = idPath.parentPath;
    if (parent?.isCallExpression() && parent.node.callee === idPath.node) {
      if (parent.node.arguments.length === 0) {
        edits.push({ start: parent.node.start!, end: parent.node.end!, text: outputName });
        return;
      }
      if (parent.node.arguments.length > 1) {
        throw new Error(
          `compile: signal writes take exactly one argument, got ${parent.node.arguments.length} for "${idPath.node.name}" (scope limit)`,
        );
      }
      if (ctx.declKind.get(id) === "derived") {
        throw new Error(`compile: cannot write to derived "${idPath.node.name}"`);
      }
      const arg = parent.node.arguments[0]!;
      edits.push({ start: parent.node.start!, end: arg.start!, text: `${outputName} = ` });
      edits.push({ start: arg.end!, end: parent.node.end!, text: "" });
      for (const sig of resolveToSignals(ctx, id, new Set())) writeDeclIds.add(sig);
      return;
    }

    if (outputName !== idPath.node.name) {
      edits.push({ start: idPath.node.start!, end: idPath.node.end!, text: outputName });
    }
  };

  if (exprPath.isIdentifier()) visit(exprPath);
  exprPath.traverse({
    Identifier(idPath) {
      if (idPath.isReferencedIdentifier()) visit(idPath);
    },
  });

  return {
    rendered: render(ctx.source, exprPath.node.start!, exprPath.node.end!, edits),
    writeDeclIds,
  };
}
```

`render` and `Edit` already exist in this file (private, from Milestone 1) —
export or reuse them rather than duplicating.

**Note**: this duplicates `analyzeExpr`'s read-rewriting logic with the write
case interleaved. That duplication is intentional for this milestone — `visit`
in `analyzeExpr` should *not* grow a write-detection branch, because
`analyzeExpr` is also used for `derived` bodies and JSX text expressions,
where a write should never be silently accepted (today it would just fail to
resolve as a write and get treated as a plain rename, which is wrong — but
fixing that latent gap is out of scope for this plan; if you notice it,
flag it in Maintenance notes, don't fix it here).

**Verify**: no test yet exercises this; `bun run typecheck` should pass for
this file in isolation once `resolveToSignals` is imported (from
`./decl-graph.js`, already exists).

### Step 3: Wire handlers into `renderElement`

In `src/compiler/render.ts`, replace the blanket attribute-rejection
(current lines 210–214) with:

```ts
const handlerAttrs: { eventName: string; rendered: string; writeDeclIds: Set<DeclId> }[] = [];
for (const attr of elementPath.get("openingElement").get("attributes")) {
  const attrName = attr.node.name;
  if (attrName.type !== "JSXIdentifier" || !/^on[A-Z]/.test(attrName.name)) {
    throw new Error(
      "compile: host element attributes are not supported yet (scope limit)",
    );
  }
  const valueNode = attr.node.value;
  if (!valueNode || valueNode.type !== "JSXExpressionContainer") {
    throw new Error(`compile: handler "${attrName.name}" must be an expression (scope limit)`);
  }
  const exprPath = attr.get("value.expression") as NodePath<t.Expression>;
  if (!exprPath.isArrowFunctionExpression()) {
    throw new Error(`compile: handler "${attrName.name}" must be an arrow function (scope limit)`);
  }
  const bodyPath = exprPath.get("body");
  if (bodyPath.isBlockStatement()) {
    throw new Error(`compile: handler "${attrName.name}" body must be a single expression, not a block (scope limit)`);
  }
  const eventName = attrName.name.slice(2).toLowerCase();
  const { rendered, writeDeclIds } = analyzeHandlerExpr(ctx, bodyPath as NodePath<t.Expression>, instanceId);
  handlerAttrs.push({ eventName, rendered, writeDeclIds });
}
```

Note this operates on the arrow function's **body**, same reasoning as
`emitDerived` in Milestone 1 — the output no longer re-invokes the user's
original function object (there is no function object in the output for a
handler's reactive writes to close over meaningfully differently from a
plain assignment), so codegen (Step 4) reconstructs a *new* wrapper function
around the rewritten body expression. This does mean **only concise
(non-block) arrow function handlers with zero parameters are supported this
milestone** — if you need to support a handler that reads the DOM event
(e.g. `(e) => count(e.target.value)`), that requires preserving
`exprPath.node.params` in the generated wrapper's signature too; do this if
the fixture needs it, otherwise defer and note it as a scope limit (see STOP
conditions — don't silently drop parameters).

Then register handlers alongside the marker the element already gets (reuse
the existing text-marker/mint-new-marker branches from Milestone 1's
`renderElement` — push into `ctx.handlers` with whichever `markerId` this
element ends up with, same shape as legacy's `registerHandlers`).

**Verify**: `bun run typecheck` clean.

### Step 4: Codegen — handler wrappers + `addEventListener` wiring

In `src/codegen.ts`, add (before the `mountComponent` block):

```ts
for (const h of handlers) {
  const updateCalls = h.updateNames.map((name) => `update_${name}();`).join(" ");
  outLines.push(
    `const __handler_${h.markerId}_${h.eventName} = (...__args) => { ${h.rendered}; ${updateCalls} };`,
  );
}
```

And add each handler's `addEventListener` call into the setup lines shared by
`mountComponent` (and, in plan 006, `hydrateComponent`):

```ts
`  __markers__.get(${JSON.stringify(h.markerId)})?.addEventListener(${JSON.stringify(h.eventName)}, __handler_${h.markerId}_${h.eventName});`
```

`generateModule`'s input type gains a `handlers: HandlerOutput[]` field where
`HandlerOutput = { markerId: MarkerId; eventName: string; rendered: string; updateNames: string[] }`
(the post-`signalToMarkers` shape — see Step 5).

**Verify**: `bun run typecheck` clean (once Step 5 supplies `updateNames`).

### Step 5: `compiler.ts` — `writeDeclIds` → `updateNames`

After `signalToMarkers` is built (`src/compiler.ts`, right after the
transitive-closure loop), add:

```ts
const handlerOutputs = ctx.handlers.map((h) => ({
  markerId: h.markerId,
  eventName: h.eventName,
  rendered: h.rendered,
  updateNames: [...h.writeDeclIds]
    .filter((id) => signalToMarkers.has(id))
    .map((id) => ctx.declOutputName.get(id)!)
    .sort(),
}));
```

Pass `handlers: handlerOutputs` into `generateModule(...)`.

**Verify**: `bun run typecheck` clean; proceed to Step 6.

### Step 6: `test/handlers.test.ts`

Model on legacy `legacy/test/handlers.test.js`, adapted to `bun:test` and
real dispatched jsdom events (pattern: `test/helpers.ts`'s
`createContainer`/`loadGenerated`, same as `test/counter.test.ts`). Minimum
cases:

1. A click handler that writes a signal (`onClick={() => count(count() + 1)}`)
   updates the DOM after `container.querySelector(...).dispatchEvent(new
   window.Event('click'))` — **this is the test deferred from plan 004's
   `test/counter.test.ts`**, now possible because a real handler exists.
2. Generated code contains a plain assignment (`count = count + 1`), not a
   call (`count(count + 1)`), and does not contain `signal(`/`derived(`
   (extends the Milestone-1 no-wrapper assertion).
3. Writing to a `derived` throws at compile time.
4. A handler with more than one argument to a signal write throws (scope
   limit — new in this plan, no legacy equivalent since legacy never
   constrained argument count explicitly).

**Verify**: `bun run test` — all pass, including the new file.

### Step 7: Update `plans/README.md`

- Set plan 005's status row to `DONE`.
- If quix's tracker approach was evaluated during this plan (see the
  "Direction findings" entry), record the decision (adopted / deferred /
  rejected) there rather than leaving it open.

## Test plan

`test/handlers.test.ts`, ≥4 cases as listed in Step 6, run via
`bun run test`. Full pipeline verified via `bun run check-all`.

## Done criteria

ALL must hold:

- [ ] `bun run check-all` exits 0 (biome, typecheck, and full test suite)
- [ ] `test/handlers.test.ts` exists and passes, including a real
      `dispatchEvent`-driven click → DOM update assertion
- [ ] Generated code for a handler that writes a signal contains a plain
      assignment, not a call-through, and no `signal(`/`derived(` substring
      anywhere (grep-check, same style as Milestone 1's assertion)
- [ ] `git status` shows changes only in: `src/compiler/state.ts`,
      `src/compiler/analyze.ts`, `src/compiler/render.ts`, `src/codegen.ts`,
      `src/compiler.ts`, `test/handlers.test.ts`, `plans/README.md`

## STOP conditions

Stop and report back (do not improvise) if:

- Any excerpt in "Current state" doesn't match the live code (drift since
  this plan was written against `0155e85`).
- A handler needs parameters (e.g. reads `event.target.value`) — this plan's
  Step 3 explicitly scopes out anything beyond zero-parameter concise-arrow
  handlers; report it rather than silently dropping the parameter list (a
  handler silently losing access to its event argument is a much worse bug
  than a loud compile error).
- A handler body is anything other than a single expression (block
  statement, multiple statements) — throw the scope-limit error from Step 3,
  don't try to support it here.
- `test/counter.test.ts` (Milestone 1) starts failing — this plan is
  additive to the pipeline built there; a regression means something in
  Steps 1–5 touched shared codegen paths incorrectly.

## Maintenance notes

- `analyzeExpr` (reads-only) and `analyzeHandlerExpr` (reads + writes)
  duplicate their identifier-visiting traversal. If a third read/write
  variant is ever needed, factor the shared traversal into one helper
  parameterized by a call-handling callback — not worth doing for two
  call sites.
- Handler parameter passthrough (see STOP conditions) is the most likely
  next gap someone hits. When implementing it, preserve
  `exprPath.node.params` verbatim in the generated wrapper's parameter list
  (they're in the handler's own lexical scope, not the component's shared
  output namespace, so no hygienic renaming is needed against
  `declOutputName`).
- The write-detection heuristic (call with ≥1 argument = write) is unchanged
  from legacy and is a property of the **authoring surface convention**
  (`signal()`'s accessor is called with 0 args to read, 1 to write) — not
  something this plan invented. Do not confuse it with the deferred
  "infer reactivity from arbitrary assignment expressions" problem
  (ADR-0004's undecided item) — that's about detecting assignments the
  compiler didn't already know about; this is about rewriting a call the
  compiler has already classified.
