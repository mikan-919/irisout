# keyed-signal Specification

## Purpose
配列状態も通常の状態と同じ`signal`で宣言し、キー指定による項目更新と一覧の識別子検査を提供する。

## Requirements

### Requirement: キー付きsignal

コンパイラは`signal(initial, keyOf)`をキー付き配列signalとして受理しなければならない(SHALL)。返されたアクセサーは読み取り、配列全体の置換、`update(key, updater)`による一項目の更新を提供しなければならない(SHALL)。

#### Scenario: 一項目を更新する
- **WHEN** 同じキー付きsignalを二つの一覧が読み、`update`で一項目を更新する
- **THEN** 両方の一覧と一覧外の依存箇所が新しい値を表示し、対象一覧要素を再利用する

#### Scenario: 配列全体を置換する
- **WHEN** キー付きsignalの設定関数へ追加、削除、並べ替えを含む配列を渡す
- **THEN** キー索引と一覧構造が新しい配列に一致する

### Requirement: キーの整合性

キー付きsignalは初期値と全体置換でキーの重複を拒否し、`update`で未知のキーとキーの変更を拒否しなければならない(SHALL)。一覧要素の`key`は`keyOf`の結果と一致しなければならない(SHALL)。

#### Scenario: 不正なキーを拒否する
- **WHEN** キーが重複した配列、存在しない更新キー、またはキーを変更する更新結果を渡す
- **THEN** 処理は原因を示す例外を投げ、以前の値を維持する

### Requirement: collection宣言の廃止

作者向けグローバルAPIは`collection()`を提供してはならない(SHALL NOT)。

#### Scenario: 旧宣言を拒否する
- **WHEN** 作者が`collection(initial, keyOf)`を宣言する
- **THEN** 型検査またはコンパイルが未対応の宣言として拒否する
