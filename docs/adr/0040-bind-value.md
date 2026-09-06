# ADR-0040: `bind:value`による入力値の双方向結合

## ステータス

決定済み(change `bind-value`、2026-09-06)

## 背景

現在の入力欄は、値の表示と書き戻しを別々に記述する。

```jsx
<textarea value={text()} onInput={(event) => text(event.currentTarget.value)} />
```

この二つは同じ文字列signalを対象にし、`value` propertyを読み書きする。入力欄ごとに
同じ配線を繰り返す理由がないため、省略記法を追加する。

## 決定

### 1. 記法と対象

`bind:value={text}`を受理する。値は現在の字句scopeで解決できる`signal`の識別子に
限る。`text()`、`state.text`、signal以外の識別子は受理しない。

対象要素は`input`、`textarea`、`select`とする。これらはブラウザ標準の`value`
propertyを持ち、入力イベントの`currentTarget.value`を文字列として扱える。

### 2. 生成規則

`bind:value={text}`は、次の二つへコンパイルする。

- `value`の動的property結合。ルート要素ではビルド時の初期値をHTMLへ焼き込み、
  構造unitではfactoryの初期化と更新でpropertyへ代入する。
- `input`イベントの直接listener。instance local signalは生成された値へ代入し、
  module共有signalは共有accessorを呼び出す。その後、既存の`update_*()`または
  module共有signalの購読通知で読み取り側を更新する。

`bind:value`と`value`または`onInput`の併用は拒否する。一つの入力に二つの値所有経路を
置くと書き戻しの順序を静的に決められないためである。

### 3. 型定義

`@irisout/compiler/jsx`の型定義は`bind:value`へ文字列signalを受け入れる。
対象要素、識別子、signalの種類はコンパイラが検査する。型検査はコンパイラのscope limit
検査を置き換えない。

### 4. 所有単位

構造unit内のlistenerと更新処理は、既存のfactory instanceが所有する。リスト項目の
ローカルsignalは項目ごとに分離する。module共有signalは既存のinstance購読を使い、
unmount時に購読を解除する。専用の入力registry、scheduler、非同期処理は追加しない。

## 却下した案

- `bind:checked`などを同時に追加する案: `value`と異なるproperty型とイベント仕様が
  必要で、今回の入力値の重複配線解消から範囲が広がるため後続の契約とする。
- `bind:value={object.text}`を受理する案: 書き戻し対象の代入規則と依存更新を別に定める
  必要があるため、signal accessorの識別子に限定する。
- 任意の要素を受理する案: `value` propertyを持たない要素まで受理すると、型定義と
  ブラウザ動作の境界が一致しないため拒否する。
