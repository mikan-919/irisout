# irisout authoring boundary

Read this reference when creating or changing authored JSX. Verify behavior against the installed package when the requested feature is not listed.

## Project wiring

Use the Vite+ plugin:

```ts
import { defineConfig } from 'vite-plus'
import { irisout } from 'irisout/vite'

export default defineConfig({
  plugins: [irisout({ entry: 'src/App.jsx', container: '#app' })],
})
```

The HTML container contains `<!--irisout-html-->`. The browser entry imports `virtual:irisout-entry`. For authored `.jsx` checking, use `allowJs`, `checkJs`, `jsx: "preserve"`, `moduleResolution: "bundler"`, and `types: ["irisout/jsx"]`.

## Component shape

- Export one unreferenced root component whose body calls `render(<JSX />)`.
- Declare local `signal`, `derived`, and `collection` state before `render()`.
- Put event handlers and lifecycle calls in the component's behavior zone after `render()`.
- Same-file and relative `.js`/`.jsx` components are compile-time composition, not runtime component objects.
- Component props use shorthand object destructuring. Spread props, aliased destructuring, recursive components, and arbitrary component values are outside the supported boundary.

```jsx
export function Counter() {
  const count = signal(0)
  const doubled = derived(() => count() * 2)

  render(
    <button type="button" onClick={increment}>
      {count()} / {doubled()}
    </button>,
  )

  function increment() {
    count(count() + 1)
  }
}
```

## Supported behavior

- Dynamic text and ordinary attributes.
- Direct DOM event handlers, including block-bodied handlers within the accepted statement set.
- Keyed lists written as direct `.map()` expressions. Use `collection(initial, keyOf)` when keyed item updates are needed.
- Ternary and `&&` conditional rendering, including nested structural units.
- `use=` actions with optional update and destroy behavior.
- `onMount`, `effect`, instance context, module-shared state, component children slots, and SVG.
- Asynchronous handlers and Promise callbacks within the compiler's accepted control-flow forms.

## Boundaries that affect design

- This is not React. Do not import React, hooks, or a JSX runtime.
- `compileProject()` follows relative `.js` and `.jsx` modules. External libraries and Vite resource imports pass through to Vite; irisout does not compile their internals.
- Handler control flow such as unsupported `try/catch/finally`, loops, or switches may be rejected when update placement cannot be determined statically.
- Request cancellation, stale-result selection, Worker protocols, persistence, routing, and external-service behavior belong to application code.
- Server rendering per request, portals, animation systems, and component-level error recovery are not part of the current contract.

## Verification

Run the project's authored-JSX type check and `vp build`. Diagnose compile failures from the reported source file, line, and column. If the generated browser code fails, retain the source, generated output, package version, browser version, and reproduction steps.
