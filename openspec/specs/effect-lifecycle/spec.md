# effect-lifecycle Specification

## Purpose

root componentと構造unitのsignal依存副作用を生成instance/factoryへ接続し、再実行前と
破棄時のcleanupを明示的に所有する。汎用schedulerを追加せず、未使用componentの生成物を
増やさない。

## Requirements

### Requirement: root effect lifecycle

The compiler SHALL accept zero-argument root movement-zone and structural-unit `effect`
callbacks, including callbacks from inline child components. Each callback SHALL run once after
the owning root or factory mount/hydrate initialization, rerun when a tracked dependency read by
its body changes, and call the previous cleanup before rerunning.
Callbacks SHALL be synchronous. Asynchronous initializers SHALL fail with a positioned scope-limit
diagnostic rather than being emitted as synchronous functions.

#### Scenario: dependency rerun

- **WHEN** an effect reads a signal and a handler updates that signal
- **THEN** the previous cleanup runs before the effect body runs again

#### Scenario: structural local dependency

- **WHEN** a list item effect reads a local signal and an item-owned handler updates that signal
- **THEN** the item's previous cleanup runs before its effect body runs again

#### Scenario: inline child dependency

- **WHEN** a conditional branch creates an inline child with an effect cleanup
- **THEN** the branch factory runs the effect once and destroys it when the branch is removed

### Requirement: cleanup ownership

The generated component instance SHALL retain a function returned by an effect callback, call the
current function once before each rerun and once at unmount, and call multiple unmount cleanups in
reverse registration order.

The compiler SHALL preserve returns inside branches and exception-handling statements in the
callback body. Every return value, including each arm of a conditional expression, SHALL be void
or satisfy the existing zero-argument cleanup function contract. Callback dependencies SHALL be the union of body reads across branches, excluding reads
inside returned cleanups. Only the cleanup actually returned SHALL be retained. Returned cleanups
SHALL capture the callback's local bindings without being moved outside their lexical scope.

#### Scenario: conditional cleanup selection

- **WHEN** an effect returns different cleanup functions from branches controlled by a signal
- **THEN** the selected cleanup runs before rerunning and once at unmount
- **AND** cleanups from unexecuted branches never run

#### Scenario: cleanup-only reads are not dependencies

- **WHEN** an effect's returned cleanup reads a signal that its body does not read
- **THEN** changing that signal does not rerun the effect

#### Scenario: directly called local helper reads

- **WHEN** an effect body directly calls a locally declared helper that reads a signal
- **THEN** changing that signal reruns the effect
- **AND** merely creating the helper or invoking it only from cleanup does not add a body dependency

#### Scenario: invalid intermediate cleanup return

- **WHEN** a branch returns an object or a function with parameters
- **THEN** compilation fails with the same scope-limit diagnostic as an invalid terminal return

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

The compiler SHALL emit structural effect runners only for factories that own an effect and SHALL
not introduce a generic runtime effect registry or scheduler.

#### Scenario: omit unused effect machinery

- **WHEN** a structural unit contains no effect callback
- **THEN** generated output contains no structural effect runner or cleanup slot

### Requirement: 保存した後始末関数の返却

再代入しない局所関数またはそのconst別名を後始末として返す形を受理しなければならない(SHALL)。返却位置、宣言前参照、閉包、finallyを保持し、通常実行用の本体を後始末用へ上書きしてはならない(SHALL NOT)。

#### Scenario: 保存した後始末と通常実行の共用
- **WHEN** 初期化が局所関数を呼んだ後、その関数のconst別名を後始末として返す
- **THEN** 初期化中の書込みは反映し、後始末へ挿入する専用の表示更新は抑止する
