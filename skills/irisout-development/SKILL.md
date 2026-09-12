---
name: irisout-development
description: Build, modify, diagnose, and verify browser applications that consume the public irisout package. Use for app setup, authored JSX, Vite+ integration, compiler diagnostics, state, lists, lifecycle, and package-version compatibility. Do not use for developing the irisout compiler or runtime itself, maintaining the irisout repository, React applications, or generic JSX questions.
---

# Build applications with irisout

Work at the application boundary exposed by the public `irisout` package. Irisout compiles authored JSX into static HTML and direct DOM updates. It is not React, and its authoring functions are compiler-recognized globals rather than imported runtime hooks.

## Workflow

1. Inspect the application's installed `irisout` version and existing Vite+ and TypeScript configuration. Preserve the selected version unless the user asks to change it. If a new application needs a version selected, check the package registry instead of relying on the version in this skill.
2. For a new application, adapt `assets/starter/`. Use `irisout/vite` in Vite configuration, `irisout/jsx` in the authored-JSX TypeScript configuration, and `virtual:irisout-entry` in the browser entry.
3. Read [references/authoring.md](references/authoring.md) before creating or changing authored JSX, state, components, lists, asynchronous handlers, lifecycle, or context. Keep the application within the documented static-analysis boundary.
4. Treat `compile: ... (scope limit)` as a report that the source is outside the supported authoring boundary. Reduce the failure to the rejected source construct, then rewrite the application within the supported forms. Do not introduce React or a general runtime state layer as a workaround.
5. Verify the application's authored-JSX type check and production build. When behavior changed, also exercise the affected interaction in a browser test or the project's existing browser-test command.

## Public package boundary

- `irisout/vite`: application build integration through the `irisout()` Vite+ plugin.
- `irisout/jsx`: global JSX and authoring API declarations for type checking.
- `irisout`: compiler API for tools that explicitly compile source without the Vite+ plugin.
- `irisout/diagnostics`: compiler diagnostic types.
- `irisout/runtime`: generated-code helpers. Application source should not import it.

Do not edit irisout compiler or runtime internals as part of an application task. If a minimal reproduction shows a package defect, report the installed version, source location, reproduction, expected result, and actual result. Propose work on the irisout repository only as a separate task.

## Completion

Finish with a passing authored-JSX type check and production build. Report any remaining scope limit and the application-level choice used to handle it. Do not publish, deploy, contact users, or change external services without authorization.
