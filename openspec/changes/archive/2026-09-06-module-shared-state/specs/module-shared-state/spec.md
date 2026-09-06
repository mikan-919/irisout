## ADDED Requirements

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

### Requirement: bounded module state

The compiler SHALL keep `compile(source)` unchanged and SHALL reject module-scope `derived()` and
`collection()` declarations with a `compile:` scope-limit error. It SHALL not add persistence,
request-local SSR isolation, implicit asynchronous scheduling, or a generic store registry.

#### Scenario: unsupported module state is rejected

- **WHEN** a linked module declares a module-scope `derived()` or `collection()`
- **THEN** `compileProject` fails with a cause-specific `compile:` error and emits no module
