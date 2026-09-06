## MODIFIED Requirements

### Requirement: root effect lifecycle

The compiler SHALL accept zero-argument root movement-zone and structural-unit `effect`
callbacks, including callbacks from inline child components. Each callback SHALL run once after
the owning root or factory mount/hydrate initialization, rerun when a tracked dependency read by
its body changes, and call the previous cleanup before rerunning.

#### Scenario: dependency rerun

- **WHEN** an effect reads a signal and a handler updates that signal
- **THEN** the previous cleanup runs before the effect body runs again

#### Scenario: structural local dependency

- **WHEN** a list item effect reads a local signal and an item-owned handler updates that signal
- **THEN** the item's previous cleanup runs before its effect body runs again

#### Scenario: inline child dependency

- **WHEN** a conditional branch creates an inline child with an effect cleanup
- **THEN** the branch factory runs the effect once and destroys it when the branch is removed

### Requirement: generated output boundary

The compiler SHALL emit structural effect runners only for factories that own an effect and SHALL
not introduce a generic runtime effect registry or scheduler.

#### Scenario: omit unused effect machinery

- **WHEN** a structural unit contains no effect callback
- **THEN** generated output contains no structural effect runner or cleanup slot
