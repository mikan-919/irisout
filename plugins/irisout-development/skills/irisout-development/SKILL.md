---
name: irisout-development
description: Build, modify, diagnose, and verify browser applications that use the irisout JSX compiler. Use for irisout project setup, authored JSX, Vite+ integration, compiler diagnostics, state updates, lists, lifecycle, and package-version compatibility. Do not use for React applications or generic JSX questions that do not use irisout.
---

# irisout development

Build against the public `irisout` package and its supported authoring boundary. Do not assume React semantics: irisout compiles authored JSX into static HTML and direct DOM updates, and its authoring functions are compiler-recognized globals rather than imported runtime hooks.

## Workflow

1. Inspect the existing project and its installed `irisout` version. For a new project, adapt the files in `assets/starter/` and install `irisout` plus `vite-plus`.
2. Use `irisout/vite` in Vite configuration, `irisout/jsx` in the authored-JSX TypeScript configuration, and `virtual:irisout-entry` in the browser entry.
3. Keep application logic within irisout's supported zones and static-analysis boundary. Read [references/authoring.md](references/authoring.md) when writing or reviewing JSX, state, components, lists, asynchronous handlers, lifecycle, or context.
4. Treat `compile: ... (scope limit)` as a supported-boundary diagnostic. Reduce it to the rejected construct before proposing compiler changes. Do not work around it by introducing React or a general runtime state layer.
5. Verify type checking and production build. For compiler or runtime changes in the irisout repository, also run the repository's full checks and relevant browser tests.

## Package contract

- `irisout`: compiler API, including `compile()` and `compileProject()`.
- `irisout/vite`: the `irisout()` Vite+ plugin.
- `irisout/runtime`: generated-code runtime helpers; application authors normally do not import it.
- `irisout/diagnostics`: compiler diagnostic types.
- `irisout/jsx`: global JSX and authoring API declarations for type checking.

Preserve the package version already chosen by the user. If selecting a version is part of the task, check the npm registry rather than assuming that this skill's examples are current.

## Completion

For an application task, finish with a passing authored-JSX type check and production build, then report any remaining scope limits. Do not publish packages, contact users, or change external services without authorization.
