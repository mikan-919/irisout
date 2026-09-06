## ADDED Requirements

### Requirement: instance-scoped context

The compiler SHALL accept top-level context keys declared as `createContext(defaultValue)` and
resolve `useContext(key)` to the nearest statically visible `provideContext(key, value)` in the
inlined component tree, or to the key default when no provider is visible. The generated code SHALL
use the owning root or structural factory's variables directly and SHALL NOT add a generic context
runtime or shared mutable module state.

#### Scenario: default value

- **WHEN** a consumer has no visible provider
- **THEN** the generated consumer expression is the context default

#### Scenario: isolated structural value

- **WHEN** each keyed item provides a value derived from its local signal
- **THEN** each item renders its own value and updates only its own factory state

### Requirement: generated output boundary

The compiler SHALL omit context-specific generated declarations and runtime imports when no context
API is authored.

#### Scenario: no context output

- **WHEN** a component does not author a context key, provider, or consumer
- **THEN** generated output contains no context runtime machinery
