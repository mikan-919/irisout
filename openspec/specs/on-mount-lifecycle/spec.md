## Purpose

ルートcomponentの要素に紐付かない初期化処理を`onMount`で記述し、component instanceの
unmountへcleanupを接続する。`effect`、context、構造unit内hookは対象外とする。

## Requirements

### Requirement: root component onMount callback

ルートcomponentの動きゾーンにある`onMount`は、0引数arrow callbackを受理しなければ
ならない(SHALL)。callbackはcomponent instanceのmountまたはhydrate完了後に一度だけ
実行されなければならない(SHALL)。

#### Scenario: mount後にcallbackを実行する

- **WHEN** root componentが`onMount(() => { ... })`を含みmountされる
- **THEN** DOM・handler・構造unit・actionの初期化後にcallbackが一度実行される

#### Scenario: hydrate後にcallbackを実行する

- **WHEN** root componentが`onMount(() => { ... })`を含み既存HTMLへhydrateされる
- **THEN** hydrate完了後にcallbackが一度実行される

### Requirement: cleanup ownership

callbackが0引数関数を返す場合、compilerはそれをinstanceが所有するcleanupとして
unmount時に一度だけ実行しなければならない(SHALL)。複数callbackのcleanupは登録順の
逆順で実行しなければならない(SHALL)。

#### Scenario: cleanupを逆順で実行する

- **WHEN** 2個以上の`onMount` callbackがcleanupを返し、instanceをunmountする
- **THEN** cleanupは登録順の逆順で一度ずつ実行される

#### Scenario: 二重unmountでcleanupを重ねて実行しない

- **WHEN** 同じinstanceへ`unmount()`を2回呼ぶ
- **THEN** 各cleanupは最初のunmountで一度だけ実行され、2回目は副作用を起こさない

### Requirement: initialization failure cleanup

onMount callbackまたはそれ以前の初期化が失敗した場合、既にcleanupを返したcallbackの
cleanupを実行しなければならない(SHALL)。残りのcleanupとinstance解放を続け、初期化の
最初の例外を呼び出し元へ再送出しなければならない(SHALL)。

#### Scenario: 後続callbackの失敗後に登録済みcleanupを実行する

- **WHEN** 先行callbackがcleanupを返し、後続callbackが例外を投げる
- **THEN** 先行cleanupを実行してDOMを解放し、後続callbackの例外を再送出する

### Requirement: output boundary

onMountを使わないcomponentの生成物に、onMount専用のcleanup変数・配線・runtime importを
出力してはならない(SHALL)。構造unit内とinline化される子componentのonMountはscope limit
で拒否しなければならない(SHALL)。

#### Scenario: 未使用生成物に専用コードを出力しない

- **WHEN** componentが`onMount`を含まない
- **THEN** 生成codeにonMount専用の識別子・配線が含まれない
