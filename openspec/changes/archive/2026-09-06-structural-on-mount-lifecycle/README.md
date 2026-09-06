# structural-on-mount-lifecycle

構造unitとcompile-time inline化された子componentの`onMount`を、そのinstanceのfactoryへ
接続する。

## Requirements

### Requirement: structural unit ownership

list item blockおよび構造unit内へinline化された子componentの`onMount`は、そのunit
factoryのmount時に登録順で一度実行され、返り値cleanupはitem削除・branch切替・祖先unit
破棄・root unmountのいずれかで一度だけ実行されなければならない(SHALL)。cleanupは
登録順の逆順で実行する。

#### Scenario: list item cleanup

- **WHEN** keyed list itemが生成される
- **THEN** item factoryがonMountを実行し、itemが削除されるとcleanupを一度実行する

### Requirement: inline child ownership

root scopeへinline化される子componentの`onMount`はroot instanceへ静的に移動し、listまたは
conditional scopeへinline化される子componentの`onMount`は現在のunit factoryへ収集しなければ
ならない(SHALL)。runtime child objectや汎用hook registryを生成してはならない(SHALL)。

#### Scenario: root child cleanup

- **WHEN** root JSXにinline childがあり、childがcleanupを返す
- **THEN** root instanceのunmountがcleanupを一度実行する

### Requirement: output boundary

onMountを持たないunitは従来のlegacy factory経路を使い、unit lifecycle専用のmount/destroy
変数を出力してはならない(SHALL)。effectのunit/child ownershipはこのchangeの対象外とし、
scope limitで拒否する。

#### Scenario: unused unit output

- **WHEN** structural unitがonMountを含まない
- **THEN** generated codeにunit onMount cleanup slotを出力しない
