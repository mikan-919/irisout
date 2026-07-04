# Plan 003: Keep static host-element attributes instead of dropping them

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 7c3c0de..HEAD -- src/ test/`
> This plan was written against commit `7c3c0de`. If `src/compiler.js` or
> `src/template.js` changed since then, compare the "Current state" excerpts
> below against the live code before proceeding; on a mismatch, treat it as a
> STOP condition.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW (additive: one new template helper, one new attribute-collection
  function wired into three existing tag-construction sites; no marker kind,
  no codegen change, no runtime change)
- **Depends on**: none (plans/001 and plans/002 are DONE; this touches a
  different part of `src/compiler.js` and doesn't build on either)
- **Category**: bug (silent data loss) / direction
- **Planned at**: commit `7c3c0de`, 2026-07-04

## Why this matters

Host-element JSX attributes other than event handlers (`onClick={...}`) are
silently dropped during compilation today. `<div class="app">` compiles to
`<div>` — the `class` is gone, with no error and no warning. This is worse
than a missing feature: it's a footgun, because the compiler already throws
loudly for every other unsupported JSX shape it can't handle (see
`src/compiler.js:190`, `:240`, `:290`, `:316` for the existing "throw on
scope limit" convention) — attributes are the one place that fails silently
instead. Anyone reaching for `class`, `id`, `type`, `placeholder`, `data-*`,
or a bare boolean attribute (`disabled`) on a host element gets broken output
with no signal anything went wrong.

`plans/README.md`'s "Direction findings surfaced but not planned" section
flagged this (originally citing `src/compiler.js:322-354` at commit
`5495746` — those line numbers are stale now that list-rendering and
handler support have shifted the file around; the current location is
`renderElement`, `src/compiler.js:393-434`) and explicitly scoped it to the
**static** half only: "dynamic attributes are a new marker kind (M) and
fulfill the concept's `Attribute#5` example" (`CONCEPT.v2.md:109`) — that's
a separate, larger plan. This plan does the cheap, safe part: string-literal
and valueless (boolean) attributes get baked into the HTML at compile time,
exactly like static text already is. Dynamic (`{expr}`-valued) attributes on
host elements go from silently-dropped to a loud scope-limit error, matching
every other unsupported shape in this compiler — that is itself a
correctness fix, independent of whoever eventually builds the dynamic
version.

## Current state

- `src/compiler.js` — the whole compiler; single file, see its header
  comment (`src/compiler.js:1-64`) for the pipeline overview.
- `src/compiler.js:184-201` — `collectHandlerAttrs`, the existing pattern for
  scanning `openingElementPath.get('attributes')` and reacting per attribute
  shape (this plan's new function sits right next to it and follows the same
  shape):

  ```js
  function collectHandlerAttrs(openingElementPath, instanceId, inStructural) {
    const result = [];
    for (const attr of openingElementPath.get('attributes')) {
      const name = attr.node.name.name;
      if (!/^on[A-Z]/.test(name)) continue;
      if (inStructural) {
        throw new Error(`compile: event handler "${name}" inside a conditional branch is not supported yet (scope limit)`);
      }
      const valueNode = attr.node.value;
      if (!valueNode || valueNode.type !== 'JSXExpressionContainer') {
        throw new Error(`compile: handler "${name}" must be an expression (scope limit)`);
      }
      const eventName = name.slice(2).toLowerCase();
      const { rendered, writeDeclIds } = analyzeHandlerExpr(attr.get('value.expression'), instanceId);
      result.push({ eventName, rendered, writeDeclIds });
    }
    return result;
  }
  ```

- `src/compiler.js:393-434` — `renderElement`, the function that builds the
  opening tag for host (lowercase) elements. It calls `collectHandlerAttrs`
  (line 404) but **never reads any other attribute** — every other attribute
  on the `openingElement` is simply never visited. Three sites build the tag
  string, and all three need the fix:

  ```js
  function renderElement(elementPath, componentsByName, instanceId, out, inStructural) {
    const tagName = elementPath.node.openingElement.name.name;

    if (/^[A-Z]/.test(tagName)) { /* component path — untouched by this plan */ }

    const handlerAttrs = collectHandlerAttrs(elementPath.get('openingElement'), instanceId, inStructural);

    const children = elementPath.get('children');
    const hasStructural = children.some((c) => c.isJSXExpressionContainer() && classifyStructuralExpr(c.get('expression')));
    if (hasStructural) {
      const inner = renderChildren(children, componentsByName, instanceId, out, inStructural);
      if (handlerAttrs.length === 0) return `<${tagName}>${inner}</${tagName}>`;                       // site A
      const markerId = `m${markerCounter++}`;
      registerHandlers(markerId, handlerAttrs);
      return `<${tagName} data-iris-id="${markerId}">${inner}</${tagName}>`;                            // site B
    }

    const hasDirectExpr = children.some((c) => c.isJSXExpressionContainer());

    if (!hasDirectExpr) {
      let inner = '';
      for (const child of children) { /* ... */ }
      if (handlerAttrs.length === 0) return `<${tagName}>${inner}</${tagName}>`;                        // site C
      const markerId = `m${markerCounter++}`;
      registerHandlers(markerId, handlerAttrs);
      return `<${tagName} data-iris-id="${markerId}">${inner}</${tagName}>`;                            // site D
    }

    const { markerId, inner } = buildTextMarker(children, instanceId);
    if (handlerAttrs.length > 0) registerHandlers(markerId, handlerAttrs);
    return `<${tagName} data-iris-id="${markerId}">${inner}</${tagName}>`;                              // site E
  }
  ```

- `src/template.js:4-6` — `escapeTemplateText`, the only escaping helper that
  exists today; it escapes for **JS-template-literal safety** (backslash,
  backtick, `${`), not for HTML-attribute safety (it does nothing to `"`):

  ```js
  export function escapeTemplateText(text) {
    return text.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${');
  }
  ```

  Attribute values need both layers: HTML-entity-escape `&` and `"` (so the
  value can't break out of its double-quoted attribute or corrupt an
  existing `&entity;`), *then* the existing JS-template-literal escaping (so
  the value can't break out of the generated module's template literal or
  accidentally interpolate `${...}`). Order between the two layers doesn't
  matter — the character sets they touch (`&"` vs. `` \`${ ``) don't overlap
  — but do the HTML layer first for readability, since it mirrors "outer
  context first, inner context second."

- `src/compiler.js:306-318` — `renderList`: list-item templates already have
  their own, narrower rule for attributes: only `key` is read
  (`src/classify.js:43-59`, `renderItemTemplate`), and handler attributes are
  explicitly rejected (`src/compiler.js:313-318`). Every other attribute on
  a list-item template tag is *also* silently dropped today, same bug — but
  fixing that is out of scope here (it's the separate "list-item template
  generality" finding in `plans/README.md`, which needs a bigger rework of
  `renderItemTemplate` since list items don't route through `renderElement`
  at all). Do not touch `src/classify.js` or the list path in this plan.

- No existing example or test uses any non-handler attribute on a host
  element (verified: `grep -rn 'class=\|style=\|disabled\|placeholder' examples/ test/` →
  no matches), so this change cannot regress an existing fixture.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|----------------------|
| Tests   | `bun run test` | all pass (27 today; ≥33 after this plan) |

(No install/build step needed — this plan touches no dependencies and no
build output.)

## Scope

**In scope** (the only files you should modify/create):
- `src/template.js` — add `escapeAttrValue`, export it
- `src/compiler.js` — import `escapeAttrValue`; add a `collectStaticAttrs`
  function next to `collectHandlerAttrs`; call it once in `renderElement` and
  splice its output into all three tag-construction sites (A/C/E above — B/D
  are the handler-marker variants of A/C, same call site once you factor it
  as described in Step 2)
- `test/attributes.test.js` (create)
- `plans/README.md` — status row, dependency notes untouched, move this
  finding out of "surfaced but not planned"

**Out of scope** (do NOT touch, even though they look related):
- Dynamic (`{expr}`-valued) attributes actually *rendering* anything — this
  plan only makes them fail loudly instead of silently. Implementing them is
  the separate "Attribute marker kind" plan the README flags.
- `src/classify.js` / `renderItemTemplate` / anything under `renderList` —
  list-item template attributes are a different finding (see "Current
  state" above). Do not extend `collectStaticAttrs` to list items.
- Component (`<Foo prop=... />`) attribute handling — `buildPropBindings`
  (`src/compiler.js:224-244`) is unrelated and already works; this plan is
  host elements (lowercase tags) only.
- Any `className`→`class` or other JSX/React-convention mapping — this
  compiler is not React; attribute names pass through verbatim, matching
  the concept's own example (`<div class="app">`, `plans/README.md:27`).
- Escaping `<` inside attribute values — not special in an HTML
  double-quoted attribute value; only `&` and `"` need entity-escaping.

## Git workflow

- Branch: `advisor/003-static-host-attributes`.
- Commit style: English imperative summary, matching `git log` (e.g. "Keep
  static host-element attributes instead of dropping them").
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Add `escapeAttrValue` to `src/template.js`

Add, next to `escapeTemplateText`:

```js
// HTML 属性値として埋め込むためのエスケープ。escapeTemplateText の
// テンプレートリテラル安全性(バックスラッシュ・バッククォート・${)に加え、
// 二重引用符で囲むための "&" と "\"" もエンティティ化する。
export function escapeAttrValue(value) {
  return escapeTemplateText(value.replace(/&/g, '&amp;').replace(/"/g, '&quot;'));
}
```

**Verify**: `bun run test` → still 27 passing (nothing calls it yet).

### Step 2: Collect and splice in static attributes in `src/compiler.js`

1. Add `escapeAttrValue` to the `./template.js` import (`src/compiler.js:69`).

2. Add a new function directly after `collectHandlerAttrs`
   (after `src/compiler.js:201`):

   ```js
   // ホスト要素の openingElement からハンドラ以外の属性を集めて HTML
   // 断片にする。値が JSXExpressionContainer な動的属性は新しい種類の
   // マーカーが要る(plans/003 でスコープ外にした Attribute マーカー、
   // CONCEPT.v2.md の Attribute#5 参照)ため、黙って握りつぶさずコンパイル
   // エラーにする。
   function collectStaticAttrs(openingElementPath) {
     let attrsSrc = '';
     for (const attr of openingElementPath.get('attributes')) {
       const name = attr.node.name.name;
       if (/^on[A-Z]/.test(name)) continue; // collectHandlerAttrs が別扱い
       const valueNode = attr.node.value;
       if (valueNode == null) {
         attrsSrc += ` ${name}`;
       } else if (valueNode.type === 'StringLiteral') {
         attrsSrc += ` ${name}="${escapeAttrValue(valueNode.value)}"`;
       } else if (valueNode.type === 'JSXExpressionContainer') {
         throw new Error(`compile: dynamic attribute "${name}" on a host element is not supported yet (scope limit)`);
       } else {
         throw new Error(`compile: unsupported attribute value for "${name}" (scope limit)`);
       }
     }
     return attrsSrc;
   }
   ```

3. In `renderElement` (`src/compiler.js:393-434`), right after the existing
   `const handlerAttrs = collectHandlerAttrs(...)` line, add:

   ```js
   const attrsSrc = collectStaticAttrs(elementPath.get('openingElement'));
   ```

4. Splice `attrsSrc` into all five return sites (A–E in the "Current state"
   excerpt above), immediately after `${tagName}` and before any
   `data-iris-id`:

   - Sites A/C: `` `<${tagName}${attrsSrc}>${inner}</${tagName}>` ``
   - Sites B/D/E: `` `<${tagName}${attrsSrc} data-iris-id="${markerId}">${inner}</${tagName}>` ``

**Verify**: `bun run test` → still 27 passing (new function exists but no
test exercises it yet — confirms you haven't broken anything already
covered).

### Step 3: Add `test/attributes.test.js`

Model the file on `test/handlers.test.js` (same `compile` + `describe`/`it`
shape). Cases:

```js
import { describe, it, expect } from 'vitest';
import { compile } from '../src/compiler.js';

describe('static host-element attributes compile into the baked HTML', () => {
  it('keeps a plain string attribute', () => {
    const { initialHtml } = compile(`
export function App() {
  return <div class="app">hi</div>;
}
`);
    expect(initialHtml).toBe('<div class="app">hi</div>');
  });

  it('keeps multiple attributes in source order, ahead of data-iris-id when the element also has a marker', () => {
    const { initialHtml } = compile(`
export function App() {
  const count = signal(0);
  return <div class="app" data-role="counter">{count()}</div>;
}
`);
    expect(initialHtml).toBe('<div class="app" data-role="counter" data-iris-id="m0">0</div>');
  });

  it('renders a valueless attribute as a bare boolean attribute', () => {
    const { initialHtml } = compile(`
export function App() {
  return <button disabled>go</button>;
}
`);
    expect(initialHtml).toBe('<button disabled>go</button>');
  });

  it('HTML-entity-escapes double quotes in the attribute value', () => {
    const { initialHtml } = compile(`
export function App() {
  return <div title='say "hi"'>t</div>;
}
`);
    expect(initialHtml).toBe('<div title="say &quot;hi&quot;">t</div>');
  });

  it('passes template-literal-sensitive characters through unharmed and uninterpolated', () => {
    const { initialHtml } = compile('export function App() { return <div title="`x` and ${y}">t</div>; }');
    expect(initialHtml).toBe('<div title="`x` and ${y}">t</div>');
  });

  it('throws a scope-limit error for a dynamic (expression) attribute on a host element', () => {
    const source = `
export function App() {
  const theme = signal('dark');
  return <div class={theme()}>t</div>;
}
`;
    expect(() => compile(source)).toThrow(/scope limit/);
  });

  it('static attributes coexist with a working click handler', async () => {
    const { code } = compile(`
export function App() {
  const count = signal(0);
  return <button class="btn" onClick={() => count(count() + 1)}>{count()}</button>;
}
`);
    expect(code).toContain('class="btn"');
    expect(code).toContain('addEventListener("click"');
  });
});
```

**Verify**: `bun run test` → all pass, 7 new tests (27 → 34 total).

### Step 4: Update `plans/README.md`

- Add a row: `| 003  | Static host-element attributes | P2 | S | — | DONE |`
  to the execution-order table.
- Remove the "Host-element attributes are dropped entirely" bullet from
  "Direction findings surfaced but not planned this round" (it's now
  planned/done) — optionally leave a one-line pointer: "static half: see
  plan 003; dynamic half (Attribute marker) still unplanned."

**Verify**: `plans/README.md` renders a 3-row status table; no other section
broken.

## Test plan

Covered by Step 3: `test/attributes.test.js`, 7 tests — plain string
attribute, multi-attribute + marker ordering, boolean/valueless attribute,
`"`-escaping, template-literal-character passthrough, dynamic-attribute
scope-limit error, and coexistence with an existing handler. Pattern file:
`test/handlers.test.js`. Verification: `bun run test` → 0 failures, 34 total
tests.

## Done criteria

ALL must hold:

- [ ] `bun run test` exits 0; `test/attributes.test.js` exists with 7 tests,
      all passing (34 total, up from 27)
- [ ] `grep -n "escapeAttrValue" src/template.js src/compiler.js` shows the
      export and its one call site
- [ ] `grep -n "collectStaticAttrs" src/compiler.js` shows the function and
      all splice sites (one call, five return-string usages)
- [ ] `git status` shows changes only in: `src/template.js`,
      `src/compiler.js`, `test/attributes.test.js`, `plans/README.md`
- [ ] `plans/README.md` status row for plan 003 says DONE

## STOP conditions

Stop and report back (do not improvise) if:

- The code at `src/compiler.js:393-434` or `src/template.js:1-6` doesn't
  match the excerpts in "Current state" (drift since this plan was written).
- Fixing this turns out to require touching `src/classify.js` or the list
  path — it shouldn't; if it does, the "Current state" analysis was wrong
  and you should stop rather than widen scope into the list-item-template
  finding.
- Any existing test in `test/` starts failing after Step 2 — the whole
  point of this plan is additive-only; a regression means an assumption
  here ("no existing fixture uses attributes") was false.
- You find a host element attribute value shape that isn't `null` /
  `StringLiteral` / `JSXExpressionContainer` (e.g. a JSX namespaced name
  like `xml:lang`) — report it rather than guessing how to handle it; the
  existing `collectHandlerAttrs`/`buildPropBindings` code makes the same
  `.name.name` assumption, so this would be a pre-existing gap, not one
  introduced here.

## Maintenance notes

- The dynamic-attribute case now throws instead of silently dropping. If/when
  someone implements the "Attribute marker" plan (new marker kind, per
  `CONCEPT.v2.md`'s `Attribute#5` example), that plan should replace the
  `throw` branch in `collectStaticAttrs` with real marker registration —
  search for `dynamic attribute` and the scope-limit error message to find
  the spot.
- List-item templates (`renderItemTemplate`, `src/classify.js:43-59`) still
  silently drop non-`key` attributes. A reviewer should not conflate that
  with this plan being "incomplete" — it's the separate, already-tracked
  "list-item template generality" finding.
- A reviewer should scrutinize: the splice points in `renderElement` (five
  return sites) — it's easy to update four and miss one, which would
  silently regress just one of the branches (e.g. elements with only
  structural children but no handlers).
