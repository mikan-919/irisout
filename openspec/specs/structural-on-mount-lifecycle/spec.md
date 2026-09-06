# structural-on-mount-lifecycle Specification

## Purpose

構造unitのfactoryとcompile-time inline childに`onMount`の所有者を与える。root scopeはroot
instance、list/conditional scopeはunit factoryがcallbackとcleanupを保持し、汎用registryを
導入せず未使用unitの生成物を増やさない。

## Requirements

### Requirement: structural onMount ownership

The compiler SHALL collect `onMount` callbacks authored in structural unit bodies and callbacks
from inline child components into the owning unit factory. A factory SHALL run its callbacks once
when its handle is mounted and run returned cleanup functions once, in reverse registration order,
when the handle is destroyed.

#### Scenario: keyed item destroy

- **WHEN** a keyed list item with an onMount callback is removed
- **THEN** the item's cleanup runs once and no runtime child component object is created

### Requirement: root inline child ownership

The compiler SHALL move callbacks from a root-scope inline child into the root component instance.
It SHALL collect child `effect` callbacks into the owning root or structural factory according to
the inline scope, and SHALL NOT emit a generic hook registry.

#### Scenario: root child unmount

- **WHEN** a root JSX inline child returns an onMount cleanup
- **THEN** root instance unmount invokes that cleanup once

### Requirement: unused output boundary

The compiler SHALL preserve the legacy structural factory path when no structural onMount is
authored and SHALL omit structural onMount cleanup slots in that case.

#### Scenario: no cleanup slot

- **WHEN** a structural unit contains no onMount callback
- **THEN** generated output contains no unit onMount cleanup slot
