# irisout application authoring boundary

Read this reference when creating or changing authored JSX in an application that depends on irisout. Verify behavior against the installed package when the requested feature is not listed. Do not use this reference as a workflow for changing the irisout compiler or runtime.

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

Import authoring APIs such as `signal`, `derived`, and `render` by name from `irisout`.
The compiler removes these imports before build-time execution and generated output.

Static hosts and build-time values appear in the generated initial HTML. Lists and conditional
branches place range comments in initial HTML and insert their contents during browser hydration.
Do not present this client-build contract as per-request server rendering.

## Component shape

- Export one unreferenced root component whose body calls `render(<JSX />)` or returns JSX. Do not combine both forms in one component. With returned JSX, place handlers and lifecycle calls before the return.
- Declare local `signal` and `derived` state before `render()`.
- Put event handlers and lifecycle calls in the component's behavior zone after `render()`.
- Same-file and relative `.js`/`.jsx`/`.ts`/`.tsx` components are compile-time composition, not runtime component objects.
- Component props use shorthand object destructuring. Spread props, aliased destructuring, recursive components, and arbitrary component values are outside the supported boundary.

```jsx
import { derived, render, signal } from 'irisout'

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
- Direct DOM event handlers. Check the installed version before using expanded function bodies.
- Keyed lists written as direct `.map()` expressions. Update arrays with `signal((previous) => next)` and use JSX `key` for identity.
- Ternary and `&&` conditional rendering, including nested structural units.
- `use=` actions with optional update and destroy behavior.
- `onMount`, `effect`, instance context, module-shared state, component children slots, and SVG.
- Asynchronous handlers and Promise callbacks within the compiler's accepted control-flow forms.

## Boundaries that affect design

- This is not React. Do not import React, hooks, or a JSX runtime.
- `compileProject()` follows relative `.js`, `.jsx`, `.ts`, and `.tsx` modules. External libraries and Vite resource imports pass through to Vite; irisout does not compile their internals.
- The unpublished source supports loops, switches, `try/catch/finally`, local function declarations and methods, and value returns in handlers and callbacks. It preserves callback results and flushes writes when the executed function completes, including return and throw paths. Released 0.3.7 still restricts statement forms and rejects nested function declarations; use a `const` arrow listener with that release. Remove the same listener in the action's `destroy` callback.
- The unpublished source accepts branch and intermediate returns in `use`, `onMount`, and `effect` initialization bodies. It retains only the result actually returned and preserves captures of local bindings. Initialization remains synchronous; return expressions must use the accepted function or action-object forms. Released 0.3.7 still requires terminal result returns.
- Remaining source limits include simple event parameters, direct calls through untracked parameter or alias function values, state accesses outside function bodies (such as default parameters or class fields), and generator update boundaries. See `docs/events-and-actions.md` in the source repository for the accepted forms; do not treat all JavaScript syntax as validated.
- Passing movement-zone helpers as callbacks or passing function values for execution from cleanup remains rejected. A cleanup's `removeEventListener` reference retains the registered listener's identity. Shared signal setters retain their existing notification behavior; cleanup suppresses compiler-inserted update calls.
- Request cancellation, stale-result selection, Worker protocols, persistence, routing, and external-service behavior belong to application code.
- Per-request server rendering is available through `irisout/ssr` and `irisout/hono`; `irisout/hono/vite` connects file routes to browser navigation. These are separate from the standard `irisout/vite` client-build entry. For Hono document pages without `index.html`, set `build.rollupOptions.input` to `{}`. The Hono plugin serves page GET requests during development; application API routes need a separate development adapter or proxy.
- Portals and component-level error recovery are outside the supported boundary. Motion is an optional extension through `irisout/motion` and `irisout/motion/vite`.
- The generated component supports `unmount()`, but the Vite virtual entry hydrates it
  automatically and does not expose that handle to application code. Exercise action cleanup by
  removing a conditional branch or keyed list item; do not claim that root unmount is available
  through the standard Vite entry.

## Verification

Run the project's authored-JSX type check and `vp build`. Diagnose compile failures from the reported source file, line, and column. If the generated browser code fails, retain the source, generated output, package version, browser version, and reproduction steps.
