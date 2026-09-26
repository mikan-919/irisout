---
name: irisout-development
description: Develop the irisout source repository itself. Use for compiler, runtime, Vite integration, repository examples and demos, tests, documentation, release work, and the repository's agent skills. Do not use for a separate application that consumes the published irisout package; use the irisout skill there.
---

# Develop irisout

Work in the irisout source repository. Follow its `AGENTS.md` and read `docs/architecture.md` before changing code and `docs/conventions.md` before writing code. Use `CONCEPT.v3.md` for the project's purpose and design principles.

Keep the repository's documents in their defined roles: `STATUS.md` records milestones and newly found limitations; `ROADMAP.md` holds future decisions and actions; `docs/adr/` records design decisions; `openspec/specs/` holds acceptance criteria. When using the OpenSpec CLI, run it through `bunx @fission-ai/openspec`.

Make the smallest coherent change that satisfies the task. Verify it with the relevant repository checks and tests from `docs/conventions.md`. Use Bun as the package manager. Do not apply the separate application's installed-package workflow, starter asset, or package-version advice to changes in this repository.
