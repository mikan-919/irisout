# structural-effect-lifecycle

構造unitとinline子componentのeffect lifecycleを実装する

## Requirements

### Requirement: structural effect ownership

The compiler SHALL collect `effect(() => void | (() => void))` callbacks authored in a list
item or conditional branch, including callbacks from inline child components, into the owning
factory. The factory SHALL run each callback once after its mount initialization and SHALL run
the previous cleanup before a dependency rerun and the current cleanup once when the factory is
destroyed.

#### Scenario: local signal rerun

- **WHEN** a structural effect reads a local signal and a unit-owned handler writes that signal
- **THEN** the cleanup runs before the effect body runs again in the same factory instance

#### Scenario: keyed item destroy

- **WHEN** a keyed item containing an inline child effect is removed
- **THEN** only that item's effect cleanup runs, and root unmount later cleans the remaining item

### Requirement: structural effect boundary

The compiler SHALL reject tracked signal writes from structural effects with a scope-limit error.
It SHALL route root signal dependencies through the existing structural marker update path and SHALL
not create a runtime effect registry or scheduler.

### Requirement: unused output boundary

When no structural effect is authored, the compiler SHALL omit structural effect runners, cleanup
slots, and effect-specific update wiring.
