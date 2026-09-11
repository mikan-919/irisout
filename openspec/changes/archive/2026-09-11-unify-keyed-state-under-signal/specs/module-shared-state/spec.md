## ADDED Requirements

### Requirement: module shared keyed signal

`compileProject(entryPath)` SHALL accept a module-scope direct `const name = signal(initial, keyOf)` declaration as one keyed signal accessor shared by every generated component instance. A referenced keyed signal SHALL be emitted once at generated-module scope with its key selector. Replacement calls and `update(key, updater)` calls SHALL synchronously notify each mounted instance, while keyed List runtime state SHALL remain instance-scoped.

#### Scenario: instances share and update a keyed signal
- **WHEN** two generated component instances read an imported keyed signal and one instance replaces its array or updates one keyed item
- **THEN** both mounted instances reflect the new array through their own List update paths

#### Scenario: unmount removes a keyed signal subscriber
- **WHEN** one of two instances is unmounted and the other updates the shared keyed signal
- **THEN** only the mounted instance is updated and the unmounted instance receives no callback

#### Scenario: unused keyed signal has no output
- **WHEN** a linked module declares a keyed signal that no compiled expression reads or writes
- **THEN** the generated module contains neither the shared keyed-state helper nor that signal

## MODIFIED Requirements

### Requirement: bounded module state

The compiler SHALL keep `compile(source)` unchanged for module-scope handling and SHALL accept module-scope keyed signal only in the direct two-argument form described above. It SHALL not add persistence, request-local SSR isolation, implicit asynchronous scheduling, or a generic store registry.

#### Scenario: unsupported module collection shape is rejected
- **WHEN** a linked module declares a module-scope keyed signal with a non-concise key selector
- **THEN** `compileProject` fails with a cause-specific `compile:` error and emits no module

## REMOVED Requirements

### Requirement: module shared collection

**Reason**: キー付き配列状態を`signal(initial, keyOf)`へ統合するため。

**Migration**: `collection(initial, keyOf)`を`signal(initial, keyOf)`へ置き換える。
