## MODIFIED Requirements

### Requirement: bounded module state

The compiler SHALL keep `compile(source)` unchanged and SHALL accept a module-scope direct
`const name = collection(initial, keyOf)` as one shared accessor. A referenced collection SHALL be
emitted once with its key selector; replacement and `update(key, updater)` calls SHALL synchronously
notify mounted instances, while keyed List state SHALL remain instance-scoped. A module-scope
collection outside this direct form SHALL fail with a `compile:` scope-limit error. The compiler SHALL
not add persistence, request-local SSR isolation, implicit asynchronous scheduling, or a generic store
registry.

#### Scenario: instances share and update a module collection

- **WHEN** two generated component instances read an imported module collection and one instance
  replaces the collection or updates one keyed item
- **THEN** both mounted instances reflect the new collection through their own List update paths

#### Scenario: unmount removes a shared collection subscriber

- **WHEN** one of two instances is unmounted and the other updates the shared module collection
- **THEN** only the mounted instance is updated and the unmounted instance receives no callback

#### Scenario: unused module collection has no output

- **WHEN** a linked module declares a collection that no compiled expression reads or writes
- **THEN** the generated module contains neither the shared collection helper nor that collection

#### Scenario: unsupported module collection shape is rejected

- **WHEN** a linked module declares a module-scope collection with a block key selector
- **THEN** `compileProject` fails with a cause-specific `compile:` error and emits no module
