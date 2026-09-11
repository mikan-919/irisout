## MODIFIED Requirements

### Requirement: module shared signal
`compileProject(entryPath)` SHALL accept a module-scope direct `const name = signal(initial)` declaration as one shared signal cell for every generated component instance. A referenced cell SHALL be emitted once at generated-module scope, and each mounted or hydrated instance SHALL subscribe its generated update path and unsubscribe at unmount. Value setters and functional setters SHALL notify mounted instances after computing the next value.

#### Scenario: instances share a module signal
- **WHEN** two generated component instances read an imported module signal and one instance invokes its value setter or functional setter
- **THEN** both mounted instances reflect the new value through their own update functions

#### Scenario: unmount removes a shared subscriber
- **WHEN** one of two instances is unmounted and the other invokes the shared signal setter
- **THEN** only the mounted instance is updated and the unmounted instance receives no callback

#### Scenario: unused shared signal has no output
- **WHEN** a linked module declares a signal that no compiled expression reads or writes
- **THEN** the generated module contains neither the shared signal helper import nor that signal

### Requirement: bounded module state
The compiler SHALL keep `compile(source)` unchanged for module-scope handling and SHALL accept module-scope signal only in the direct one-argument form. It SHALL not add persistence, request-local SSR isolation, implicit asynchronous scheduling, or a generic store registry.

#### Scenario: unsupported module collection shape is rejected
- **WHEN** a linked module declares a module-scope signal with two arguments
- **THEN** `compileProject` fails with a cause-specific `compile:` error and emits no module

## REMOVED Requirements

### Requirement: module shared keyed signal
**Reason**: 配列を通常のmodule共有signalとして扱うため。
**Migration**: 二引数を削除し、関数形式の設定を使う。
