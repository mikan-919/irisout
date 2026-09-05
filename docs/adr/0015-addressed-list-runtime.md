# ADR-0015: list/item/bindingアドレスによるList最小ランタイム

## ステータス

**決定済み・第1段階実装済み**(2026-09-04、CONCEPT.v3移行)。
実ブラウザ比較と変更item直接通知の比較fixtureは実施済み。製品導入は通知元となる
collection更新APIまで延期した(ADR-0017)。

## コンテキスト

ADR-0005のList実装はkeyed reuseを行う一方、配列更新のたびにkeyを全走査し、
全itemの`handle.update()`と`appendChild()`を実行していた。DOMノードは再生成
されないが、値が変わっていないbindingへのDOM代入と、順序が変わっていない
要素の再挿入が発生する。

CONCEPT.v3ではランタイムを0にすることを目的から外し、直接DOM更新を維持した
まま更新粒度を最適化する。Listは共通アルゴリズムと実行時状態を持つ方が、
生成コードへ同じdiff処理を展開するより責務を明確にできる最初の対象である。

## 決定

### 1. 更新先をlistId / itemId / bindingIdで分離する

Listごとにコンパイル時のmarker IDを`listId`、key式の結果を`itemId`、item内の
テキストmarker IDまたは`markerId:属性名`を`bindingId`として扱う。

3値を文字列連結またはハッシュ化しない。Listの`Map<itemId, record>`と、各itemの
`Map<bindingId, previousValue>`に分け、衝突処理とホットパスでの文字列生成を避ける。
これは仮想DOMのノードIDではなく、既に解決済みの実DOM更新先へのアドレスである。

### 2. 共有ランタイムはkey照合とDOM順序だけを担当する

`createListRuntime()`がList単位の状態を作り、`reconcileList()`が次を行う。

- keyから既存item recordを取得する
- 新規keyだけfactoryを呼ぶ
- 消えたkeyのDOMとrecordを削除する
- 末尾から`insertBefore()`し、親またはnextSiblingが異なる要素だけ移動する

同じ更新内でkeyが重複した場合、複数itemを1つのrecordへ黙って潰すと
item addressが一意でなくなるため、`reconcileList()`は明示的に例外を投げる。

item固有の式やDOM構造をランタイムは知らない。既存itemの更新はコンパイラが
生成した`handle.update(next)`へ委譲する。

### 3. item内はbinding単位でDOM更新を抑止する

factoryの`update()`は従来どおり式を評価する。その値を
`updateListBinding(itemState, bindingId, value)`へ渡し、初回または
`Object.is(previous, value)`がfalseの場合だけ対象の`textContent`、property、
`setAttribute()`を実行する。

式の評価回数は変えないため、既存構文の意味を維持しながらDOMへの書き込みだけを
細粒度化できる。同じbindingIdでもitemStateが別なので、item間では衝突しない。

### 4. Listを使う生成物だけruntime helperをimportする

Listを含まないコンポーネントの生成コードは従来どおり`mount`/`hydrate`だけを
importする。Listがトップレベルまたはネスト位置に存在する場合だけ3つのList
helperを追加する。

## 対象外

- 配列操作の記録や変更itemの直接通知によるkey全走査の省略(ADR-0017へ移管)
- microtask単位の更新バッチ
- List itemイベント委譲(専用のclick相当比較はADR-0021へ移管。native event semanticsを
  含むproduction採否は未決定)
- binding IDの整数packing
- 仮想DOM、Fiber、汎用スケジューラ

これらは実ブラウザの速度・メモリ・生成コードサイズを比較してから別ADRで決める。

## 検証

`test/list-conditional.test.ts`で、既存の追加・削除・keyed reuse・ネスト挙動に加え、
1件だけ値を変更したときにList親のchildList mutationと未変更itemのbinding mutationが
発生しないことを`MutationObserver`で固定する。
