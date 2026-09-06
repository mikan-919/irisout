## ADDED Requirements

### Requirement: root effect lifecycle

The compiler SHALL accept zero-argument root movement-zone `effect` callbacks, execute each
callback once after mount or hydrate initialization, and rerun a callback when a tracked root
signal or derived value read by its body changes. When rerunning, the previous cleanup SHALL be
called before the callback body.

#### Scenario: dependency rerun

- **WHEN** an effect reads a signal and a handler updates that signal
- **THEN** the previous cleanup runs before the effect body runs again

### Requirement: cleanup ownership

The generated component instance SHALL retain a function returned by an effect callback, call the
current function once before each rerun and once at unmount, and call multiple unmount cleanups in
reverse registration order.

#### Scenario: unmount cleanup

- **WHEN** an instance with an effect cleanup is unmounted twice
- **THEN** the cleanup runs only during the first unmount

### Requirement: write boundary

The compiler SHALL reject effect bodies that write tracked signals or derived values. It SHALL NOT
introduce an implicit scheduler or reentrant effect queue.

#### Scenario: reject effect signal write

- **WHEN** an effect body calls a tracked signal setter
- **THEN** compilation fails with a scope-limit error

### Requirement: generated output boundary

The compiler SHALL omit effect-specific declarations, rerun wiring, and runtime imports when no
effect is authored. Effects in structural units and inline child components are outside this
change and SHALL be rejected with a scope-limit error.

#### Scenario: omit unused effect machinery

- **WHEN** a component does not author an effect
- **THEN** generated output contains no effect runner, cleanup slot, or effect runtime import
