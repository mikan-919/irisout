## MODIFIED Requirements

### Requirement: instance-scoped context

The compiler SHALL resolve context providers in compiler-owned list item and conditional branch
factories to the nearest inline consumer for that factory instance. Branch switching and keyed
reconciliation SHALL not share provider values between factory instances, and the compiler SHALL
continue to omit a runtime context registry.

#### Scenario: default value

- **WHEN** a consumer has no visible provider
- **THEN** the generated consumer expression is the context default

#### Scenario: isolated structural value

- **WHEN** each keyed item provides a value derived from its local signal
- **THEN** each item renders its own value and updates only its own factory state

#### Scenario: conditional provider switch

- **WHEN** a conditional branch provides `light` or `dark` according to a tracked signal
- **THEN** switching the signal destroys the old branch and renders the nearest provider from the
  new branch

#### Scenario: no context output

- **WHEN** a component does not author a context key, provider, or consumer
- **THEN** generated output contains no context runtime machinery
