# cross-function-handler-writes

## Purpose

ハンドラ/action 本体から動きゾーン(render() より後ろ)の補助関数を呼ぶ
(`onClick={() => toggle(todo.id)}`)場合に、呼び出し先本体の signal 書き込みを
追跡し `update_*()` を確実に発火させる(ADR-0013)。callee の binding 同一性
確認・呼び出し先本体の再帰解析と `writeDeclIds` 合流・書き換え済み関数の出力
への単一 emit・追跡不能な呼び出しの素通し/拒否の線引きを扱う。

## Requirements

### Requirement: 動きゾーン関数呼び出しの追跡
コンパイラは、ハンドラ/action 本体内の呼び出し式のうち、callee が識別子で
あり、binding 解決の結果が動きゾーン(render() より後ろ)の function 宣言と
同一ノードであるものを追跡対象としなければならない(SHALL)。呼び出し先
本体はハンドラ本体と同じ規則(4文種制限・読み取り書き換え・書き込み代入化)
で解析し、その書き込み先 signal 集合を呼び出し元ハンドラへ合流する。
`update_*()` の挿入位置は従来どおり呼び出し元ハンドラ本体の末尾とする。

#### Scenario: inline arrow から引数つきで補助関数を呼ぶ(発見時の再現形)
- **WHEN** authored コンポーネントがリストアイテムのハンドラ
  `onClick={() => toggle(todo.id)}` を持ち、動きゾーンに
  `function toggle(id) { todos(todos().map(...)) }` が宣言されている
- **THEN** コンパイラは compile error を出さずに完了し、生成コードを実行
  するとクリックで `todos` に依存する表示が更新される(黙って落ちない)

#### Scenario: 書き込みの更新はハンドラ末尾で一括
- **WHEN** ハンドラ本体が追跡対象の呼び出しを複数回含む
- **THEN** 対応する `update_*()` は呼び出し元ハンドラ本体の末尾に1回だけ
  挿入され、emit された呼び出し先関数の本体には挿入されない

#### Scenario: 追跡対象呼び出しの後ろの return は拒否(ADR-0009 D3)
- **WHEN** ハンドラ本体が追跡対象の呼び出しの後(ソース順)に `return` を含む
- **THEN** コンパイラは `(scope limit)` を含む compile error で拒否する

### Requirement: 再帰追跡(深さ制限なし・循環打ち切り)
コンパイラは、追跡対象の呼び出し先本体に含まれる呼び出しにも同じ追跡規則を
再帰的に適用しなければならない(SHALL)。深さ制限は設けない。自己再帰・
相互再帰は訪問済み管理で打ち切り、書き込み先集合は推移的に合流する。

#### Scenario: 2階層の呼び出しでも更新が届く
- **WHEN** ハンドラが `save()` を呼び、`save` が `toggle()` を呼び、`toggle`
  だけが signal に書き込む(いずれも動きゾーンの function 宣言)
- **THEN** コンパイラは compile error を出さずに完了し、ハンドラ末尾に
  `toggle` の書き込み先に対応する `update_*()` が挿入される

#### Scenario: 相互再帰でもコンパイルが停止しない
- **WHEN** 動きゾーンの `a()` と `b()` が互いを呼び合い、ハンドラが `a()` を呼ぶ
- **THEN** コンパイラは無限再帰せずに完了し、両関数の書き込み先が
  ハンドラへ合流する

### Requirement: 呼び出し先関数の出力への単一 emit
コンパイラは、追跡対象として呼ばれた動きゾーン関数を、書き換え済み本体を
持つモジュールスコープの関数宣言として出力に**1回だけ** emit しなければ
ならない(SHALL)。関数名は authored 名のまま、呼び出し式も書き換えずに
出力する。追跡対象として呼ばれなかった動きゾーン関数は出力に含めない。

#### Scenario: 複数ハンドラから呼ばれても emit は1回
- **WHEN** 2つの異なるハンドラが同じ動きゾーン関数 `toggle` を呼ぶ
- **THEN** 生成モジュールに `function toggle` の宣言はちょうど1回だけ現れる

#### Scenario: 未使用の動きゾーン関数は emit されない
- **WHEN** 動きゾーンにどのハンドラからも参照も呼び出しもされない
  function 宣言がある
- **THEN** その関数は生成モジュールに現れない

#### Scenario: 生成側予約名と衝突する authored 名は拒否
- **WHEN** 追跡対象として呼ばれる動きゾーン関数の名前が生成側の予約名
  (`update_<signal名>` または `__` 接頭辞)と衝突する
- **THEN** コンパイラは compile error で拒否する(黙ってリネームしない)

### Requirement: 追跡できない呼び出しの線引き
コンパイラは、callee の binding が解決できない呼び出し(グローバル等)を
従来どおり素通ししなければならない(SHALL)。binding は解決できるが
動きゾーンの function 宣言でないもの(仮引数・ハンドラ内ローカル宣言・
変数ゾーン由来の識別子等)の呼び出しは `(scope limit)` を含む
compile error で拒否しなければならない(SHALL)。

#### Scenario: グローバル呼び出しは素通し
- **WHEN** ハンドラ本体が `console.log(count())` のように binding 未解決の
  識別子を呼ぶ
- **THEN** コンパイラは compile error を出さずに完了し、呼び出しは
  そのまま出力される

#### Scenario: 仮引数経由の呼び出しは拒否
- **WHEN** ハンドラ `function h(e) { ... }` の本体が第1引数のメンバーでない
  ローカル束縛の関数値(例: ハンドラ内 `const f = ...` で宣言した `f()`)を呼ぶ
- **THEN** コンパイラは `(scope limit)` を含む compile error で拒否する
