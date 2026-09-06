# `bind:value`の実装

## 問題

入力値とsignalを同期するには、現在は`value={text()}`と
`onInput={(event) => text(event.currentTarget.value)}`を個別に記述する必要がある。
この配線は`input`、`textarea`、`select`で同じ意味を持つため、コンパイラが省略記法を
受理できる。

## 変更

- `bind:value={signal}`を文字列signalの値読み取りと`input`イベントの書き戻しへ変換する。
- `input`、`textarea`、`select`だけを対象とする。
- signal以外の式、`value`との併用、`onInput`との併用はコンパイル時に拒否する。
- ルート、リスト項目、条件分岐の各instanceが既存の更新経路を使う。

## 非目標

- `bind:checked`など他の結合記法。
- メンバー式やsetter関数を対象にした書き戻し。
- 非同期処理や新しい購読機構。
