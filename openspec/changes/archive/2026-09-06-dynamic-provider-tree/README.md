# dynamic-provider-tree

構造unitの動的provider treeをcontextへ接続する

## Requirements

### Requirement: structural provider tree

The compiler SHALL resolve providers in compiler-owned list items and conditional branches to
the nearest inline consumer in that factory. Switching a branch or reconciling a keyed item SHALL
use the provider value owned by the new or existing factory instance.

#### Scenario: conditional provider switch

- **WHEN** a conditional branch provides different values and the condition changes
- **THEN** the new branch renders its own provider value without sharing the old branch

### Requirement: provider output boundary

The compiler SHALL preserve the existing static replacement strategy and SHALL NOT emit a runtime
provider registry, context Map, or generic tree traversal.

#### Scenario: unused context output

- **WHEN** a component tree does not author context operations
- **THEN** generated output contains no context runtime machinery
