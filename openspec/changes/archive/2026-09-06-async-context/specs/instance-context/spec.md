## MODIFIED Requirements

### Requirement: instance-scoped context

The compiler SHALL accept top-level `createContext(defaultValue)` and
`createAsyncContext(defaultPromiseLike)` keys. It SHALL resolve `useContext(key)` to the nearest
visible provider or default expression, preserve the PromiseLike expression for async keys, and
avoid adding a runtime context object or shared mutable module state.

#### Scenario: default value

- **WHEN** a consumer has no visible provider
- **THEN** the generated consumer expression is the context default

#### Scenario: isolated structural value

- **WHEN** each keyed item provides a value derived from its local signal
- **THEN** each item renders its own value and updates only its own factory state

#### Scenario: conditional provider switch

- **WHEN** a conditional branch provides different context values and the condition changes
- **THEN** the new branch resolves the nearest provider from its own factory

#### Scenario: async value resolution

- **WHEN** an effect calls `.then()` on `useContext(AsyncKey)`
- **THEN** the generated effect uses the statically resolved PromiseLike provider value without
  an implicit await or scheduler

#### Scenario: no context output

- **WHEN** a component does not author a context key, provider, or consumer
- **THEN** generated output contains no context runtime machinery
