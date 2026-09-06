# 動的属性結合の追加要件

## ADDED Requirements

### Requirement: `bind:value`による文字列signalの双方向結合

コンパイラは、`input`、`textarea`、`select`要素の
`bind:value={name}`を、現在の字句scopeで解決できる`signal`識別子の値読み取りと
`input`イベントからの書き戻しへ変換しなければならない(SHALL)。通常の要素では
signalの現在値を`value` propertyへ反映し、構造unitではfactory内で同じpropertyを
設定する。書き戻しはローカルsignalへの代入、またはmodule共有signal accessorの
呼び出しで行い、既存の更新経路を使用する。

#### Scenario: 入力イベントがsignalと表示を更新する

- **WHEN** `const text = signal('start')`と`<input bind:value={text} />`を持つcomponentを
  mountし、input要素のvalueを`changed`へ変更して`input`イベントを発生させる
- **THEN** signalの更新を読むテキストは`changed`になり、生成コードはinputイベントの
  直接listenerとvalue property結合を含む

#### Scenario: 構造unitのローカルsignalを項目ごとに分離する

- **WHEN** 各keyed list itemが個別の`const draft = signal(item.text)`と
  `<input bind:value={draft} />`を持ち、1項目だけへinputイベントを発生させる
- **THEN** 発生元のitemだけが更新され、他のitemのvalueと表示は変わらない

#### Scenario: module共有signalをinstanceへ通知する

- **WHEN** `compileProject()`で読み込むmoduleが`const text = signal('start')`をexportし、
  複数component instanceが`<input bind:value={text} />`を読む
- **THEN** 一つのinstanceのinputイベントによる書き戻しが全mounted instanceのvalueと表示を
  更新し、unmount済みinstanceには更新を送らない

#### Scenario: 不正な結合対象と競合を拒否する

- **WHEN** `name()`、`object.name`、signal以外の識別子、対象外要素、`value`、または
  `onInput`との併用を`bind:value`へ指定する
- **THEN** コンパイラは`compile:`で始まり`(scope limit)`を含むエラーを返す

### Requirement: `bind:value`の型宣言

JSX型定義は`bind:value`へ文字列signalを受け入れる型を提供しなければならない(SHALL)。
これはコンパイラの要素範囲、識別子解決、scope limit検査を置き換えない。

#### Scenario: 利用者向けJSXの型検査

- **WHEN** 別workspaceのauthored JSXが`<textarea bind:value={text} />`を使い、`text`が
  `signal(string)`である
- **THEN** 通常のJSX型検査が成功する
