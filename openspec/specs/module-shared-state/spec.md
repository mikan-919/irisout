# module-shared-state Specification

## Purpose
`compileProject`のリンク済みmoduleに限定した直接signalとderivedを、component runtimeや
汎用storeなしで共有する。参照された共有stateだけが生成moduleへ出力される。

## Requirements

### Requirement: module shared signal

`compileProject(entryPath)` SHALL accept a module-scope direct `const name = signal(initial)`
declaration as one shared signal cell for every generated component instance. A referenced cell
SHALL be emitted once at generated-module scope, and each mounted or hydrated instance SHALL
subscribe its generated update path and unsubscribe at unmount.

#### Scenario: instances share a module signal

- **WHEN** two generated component instances read an imported module signal and one instance
  invokes its setter
- **THEN** both mounted instances reflect the new value through their own update functions

#### Scenario: unmount removes a shared subscriber

- **WHEN** one of two instances is unmounted and the other invokes the shared signal setter
- **THEN** only the mounted instance is updated and the unmounted instance receives no callback

#### Scenario: unused shared signal has no output

- **WHEN** a linked module declares a signal that no compiled expression reads or writes
- **THEN** the generated module contains neither the shared signal helper import nor that signal

### Requirement: module shared derived

`compileProject(entryPath)` SHALL accept a module-scope direct
`const name = derived(() => expression)` declaration as one read-only function shared by every
generated component instance. A referenced function SHALL be emitted once at generated-module
scope. Its dependencies SHALL use the existing derived graph and shared-signal subscription
path; the compiler SHALL not add a derived cache, derived subscriber registry, scheduler, or
per-request state boundary.

#### Scenario: instances share and recompute a module derived value

- **WHEN** two generated component instances read an imported module derived value that depends on
  an imported module signal and one instance invokes the signal setter
- **THEN** both mounted instances recompute the derived value through their own update functions

#### Scenario: module derived value is read-only

- **WHEN** compiled code calls a module-scope derived binding with one or more arguments
- **THEN** `compileProject` fails with a `compile:` scope-limit error

#### Scenario: unused module derived value has no output

- **WHEN** a linked module declares a derived value and no compiled expression reads or writes it
- **THEN** the generated module contains neither that derived function nor its unused shared-state
  dependencies

### Requirement: bounded module state

The compiler SHALL keep `compile(source)` unchanged and SHALL reject module-scope `collection()`
declarations with a `compile:` scope-limit error. It SHALL not add persistence, request-local SSR
isolation, implicit asynchronous scheduling, or a generic store registry.

#### Scenario: unsupported module collection is rejected

- **WHEN** a linked module declares a module-scope `collection()`
- **THEN** `compileProject` fails with a cause-specific `compile:` error and emits no module
