## REMOVED Requirements

### Requirement: キー付きsignal
**Reason**: 配列を通常のsignalと関数形式更新で扱うため。
**Migration**: `signal(initial, keyOf)`を`signal(initial)`へ変更し、`.update()`を`signal(previous => next)`へ置き換える。

### Requirement: キーの整合性
**Reason**: 識別子の責務をJSXの`key`へ限定するため。
**Migration**: 一覧要素の`key`を維持し、配列更新は新しい配列を返す。

### Requirement: collection宣言の廃止
**Reason**: 廃止済みAPIの拒否はsignalの一引数契約へ統合するため。
**Migration**: `signal(initial)`を使う。
