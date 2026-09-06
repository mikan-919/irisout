# effect-lifecycle

ルートcomponentの`effect`を依存信号に接続し、再実行前とunmount時のcleanupを
instanceが所有する。

## Requirements

### Requirement: root effect callback

ルートcomponentの動きゾーンにある`effect`は、0引数arrow callbackを1個受理しなければ
ならない(SHALL)。callbackはmountまたはhydrate完了後に一度実行されなければならない
(SHALL)。callbackが読み取ったroot signalまたはderivedが更新された場合、前回のcleanupを
先に実行してからcallbackを再実行しなければならない(SHALL)。

#### Scenario: mount後に初回実行する

- **WHEN** root componentが`effect(() => { ... })`を含みmountされる
- **THEN** DOM・handler・構造unit・action・初期`onMount`の前処理後にeffectを一度実行する

#### Scenario: 依存信号の更新で再実行する

- **WHEN** effect callbackが`count()`を読み、handlerが`count`を書き換える
- **THEN** 前回cleanupを一度実行してからcallbackを再実行する

### Requirement: effect cleanup ownership

callbackが0引数関数を返す場合、compilerはそれをinstanceが所有するcleanupとして保持し、
再実行前とunmount時に一度だけ実行しなければならない(SHALL)。複数effectのunmount cleanupは
登録順の逆順で実行しなければならない(SHALL)。

#### Scenario: unmountで現在のcleanupを解放する

- **WHEN** effect callbackがcleanupを返したcomponent instanceをunmountする
- **THEN** 現在保持しているcleanupを一度実行し、二重unmountでは再実行しない

### Requirement: effect write boundary

effect callbackが追跡対象signalまたはderivedへ書き込む場合、compilerはscope limitで
拒否しなければならない(SHALL)。effect自身の更新による再入を暗黙にスケジュールしない。

### Requirement: output boundary

`effect`を使わないcomponentの生成物にeffect専用のcleanup変数・再実行配線・runtime importを
出力してはならない(SHALL)。構造unit内およびinline化される子componentのeffectは対象外とし、
scope limitで拒否しなければならない(SHALL)。
