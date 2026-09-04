# ADR-0019: keyed collectionによるList item直接更新

## ステータス

**決定済み・実装済み**(2026-09-04)。

## コンテキスト

ADR-0015のList runtimeは不要なDOM書き込みと再挿入を抑止するが、通常の
`signal(array)` setterでは1件の値変更でも全keyを走査する。ADR-0017の実ブラウザ比較では、
変更item IDを呼び出し側から直接渡せれば、N=10,000でもitem数に比例しない更新経路になると
確認できた。

任意の配列式から変更itemを推測するとコンパイラ境界が広がるため、identityと変更itemを
明示できる最小のauthoring APIを追加する。

## 決定

### 1. `collection(initial, keyOf)`を追加する

```jsx
const items = collection(initialItems, (item) => item.id)
```

読み取り`items()`と配列全体の置換`items(next)`は`signal()`と同じ形を保つ。
`keyOf`はcollection内で恒久的なidentityを定義する。初期値または全体置換に重複keyがあれば
明示的に例外を投げ、置換失敗時は以前のcollectionを維持する。

### 2. `items.update(key, updater)`だけを細粒度操作として追加する

```jsx
items.update(id, (item) => ({ ...item, text: item.text + '!' }))
```

runtimeはkeyから配列indexをMapで引き、対象要素だけを置き換える。存在しないkeyは例外とする。
updaterの返り値を`keyOf`へ通した結果は指定keyと`Object.is`で一致しなければならない。
identity変更は構造変更なので例外とし、collectionを変更しない。

### 3. 直接の`items().map()`だけをList直接更新へ接続する

コンパイラはListの配列式がcollectionの直接読み取りである場合、そのcollectionとList markerを
関連付ける。JSX `key`はcollectionの`keyOf`と同じidentityを返さなければならず、reconcile時に
一致しなければ例外とする。`items.update()`は各関連Listの`Map<itemId, record>`からhandleを取得し、
共有item updaterを直接呼ぶ。同じcollectionを複数Listで描画した場合はすべて更新する。

List以外の依存markerも通常どおり更新する。`filter()`、`slice()`、derived、条件分岐内List、
その他の式を介する場合はitem変更で構造が変わり得るため、従来の更新経路へフォールバックする。

`items(next)`は追加・削除・並べ替えを含み得るので、常にindexを再構築して通常の
`reconcileList()`を実行する。

### 4. authoring APIは生成物から消す

生成コードはcollection accessorを保持せず、配列、key-index、List runtime、および
コンパイラ生成の`update_<name>_item(key, updater)`へ変換する。汎用subscribe APIや
アプリケーション全体のリアクティブグラフは導入しない。

## 対象外

- `add`、`remove`、`move`などの構造操作メソッド
- 複数item更新とbatch
- 任意の配列式から変更itemを推測する最適化
- 公開subscribe API
- collection identityとJSX `key`の静的等価性証明

## 結果

- 1件の値更新は配列とListの全key走査を省き、対象handleへ直接到達する。
- 通常setterの互換性を保ち、構造変更は既存の堅牢なreconcile経路を使う。
- identity、未知key、重複keyの失敗条件が明示される。
- 将来構造操作APIを追加する場合も、今回のindexと直接通知経路を再利用できる。
