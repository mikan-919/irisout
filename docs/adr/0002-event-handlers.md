# ADR-0002: イベントハンドラと signal 書き込みによる自動更新

## ステータス

決定済み(常在ホスト要素、およびM5/M5.5のfactory-per-unit内。イベント委譲は
ADR-0021でclick相当だけを測定し、production採用は保留)

## コンテキスト

ADR-0001 以降のマイルストーンで、コンパイラは JSX を静的 HTML と signal ごとの
専用 `update_*` 関数へ変換できるようになった。しかし生成物には
`update_*` を呼ぶ手段が一切なく、テストコードが `mod.count(5);
mod.update_count();` と手動で叩くことでしか動かせなかった。

CONCEPT.v2.md はハンドラ(ハンドラ)を「実行時発見」の対象として挙げている
(51行目)。しかし現在のアーキテクチャでは、ハンドラはビルド時に一度も
実行されない(イベントコールバックだからである)。JSX 属性として静的に
現れる以上、これは静的解析の領域であり、CONCEPT.v2.md の想定を実装の実態に
合わせて修正する必要がある。

なお、下記の初期スコープ制限に書かれた「リスト/条件分岐を更新時に
`innerHTML`で再生成する」前提は、M5/M5.5(ADR-0005)のfactory-per-unit実装で
更新済みである。現在はkeyed reuse中のitem/branch DOMと直接listenerを保持するが、
イベント委譲を採用したわけではない。

## 決定

### 1. 発見はビルド時実行ではなく静的解析

`onClick={...}` のようなハンドラ属性は、ビルド時の1回限りの Node 実行
(discovery のための実行)では一度も呼ばれない。したがって
`analyzeExpr`/`analyzeHandlerExpr` による静的な AST 走査で読み取りと
書き込みを発見する。これは CONCEPT.v2.md がハンドラを実行時発見に
分類していたことへの明示的な訂正である。

### 2. 書き込み検出:引数ありの追跡済み呼び出し = 書き込み

ハンドラ式の中で、追跡済み signal/derived に解決される識別子への
`CallExpression` のうち、引数が1つ以上あるものを書き込みとみなす
(`src/runtime.js` のアクセサは引数なし呼び出しを読み取り、引数ありを
書き込みとして扱う設計と対称)。

- 書き込み先が `derived` の場合はコンパイルエラー
  (`compile: cannot write to derived "<name>"`)。
- それ以外は `resolveToSignals` でルート signal まで推移閉包を取り、
  書き込まれた declId の集合を作る。
- `count(count() + 1)` のように同じ signal への読み書きが同居しても、
  外側の呼び出し(引数あり = 書き込み)だけを書き込みとして拾うため、
  `update_count()` は1回しか emit されない。
- 書き込み先がどのマーカーからも参照されない signal の場合(=
  `signalToMarkers` に現れない場合)、対応する `update_*` はそもそも
  生成されないため、そのような書き込みへの update 呼び出しは省略する。

### 3. マウント時の配線

ハンドラを持つホスト要素には、既存のマーカーID採番機構を使って
`data-iris-id` を必ず持たせる(テキストマーカーが既にIDを持っていれば
それを再利用し、無ければ新規採番する)。ハンドラ本体は
`const __handler_<markerId>_<eventName> = (...__args) => { (<元の式>)(...__args); update_x(); ... };`
というモジュールレベルの const として emit し、`mountComponent` の中で
`__markers__.get("<markerId>").addEventListener("<eventName>", __handler_<markerId>_<eventName>);`
を1行追加する。

`__handler_*` const は `update_*` 関数宣言を参照するが、関数宣言は
巻き上げられるため定義順は問題にならない - `__handler_*` はマウント後に
しか*呼ばれない*ので、参照時点で `update_*` は既に存在する。

配線は標準の`addEventListener(eventName, handler)`を使い、capture/passive/once
などのoptionsは渡さない。したがってnative eventはブラウザからそのままhandlerへ
届き、`event.target`は発火元、`event.currentTarget`はそのlistenerを登録した
要素になる。現在の実装では、rootのhandlerもfactory内のList item/conditional
handlerもこの直接配線であり、委譲によるcurrentTargetの変更やevent objectの
proxy化は行っていない。

ラップ方式は「ユーザーの式を呼んでから、そのあとで update を呼ぶ」
という最も単純な形にした(rendered テキストを再パースして本体を書き換える
のではなく、呼び出し結果をそのまま使う)。この結果、ハンドラが実際には
値を変えなかった場合(条件分岐する書き込みなど)でも update は必ず走る。
テキストマーカーの更新は冪等なので副作用として問題にならない、という
判断である。

### 4. prop write-back はそのまま成立する

子コンポーネントが `prop('x')` に書き込むと、そのエイリアス機構
(`src/compiler.js` の裸読み取りエイリアス、buildPropBindings 参照)に
より、子の declId は親の signal と同じ declId を指している。したがって
書き込み検出・`resolveToSignals` は追加の仕組みなしで親側のルート signal
を見つけ、親側の `update_*` を呼ぶ。新しいエイリアス機構は不要だった -
`test/handlers.test.js` の write-back テストで確認済み。

## スコープ制限(この回で対応しないこと)

- **条件分岐ブランチ内・リストアイテム内のハンドラ**: M5/M5.5で
  `<template>`+`cloneNode(true)`とfactory-per-unitを導入したため、対応する
  handlerは各factory内の要素へ直接`addEventListener`できる。keyed reuse中は
  同じDOM/handlerを保持し、keyが脱落したときはDOMとhandleを破棄する。2階層を
  超える構造ユニット、`use=`の構造ユニット内利用など、別途STATUS.mdに記す
  scope limitは残る。
- **イベント委譲**: ADR-0021で実Chromiumのclick相当fixtureを測定したが、
  全イベントへのproduction採用は本ADRの決定に含めない。`blur`のような
  non-bubbling eventや`event.currentTarget`を観測するhandlerの意味を保つ
  具体設計が必要である。
- **非ハンドラのホスト属性**(`class`, `value` など):今回のスコープ外。
  引き続き無視する。

## 未決定事項(後続で詰める)

- 実生成に近いfixtureで`click`/`change`/`input`/`keydown`/`dblclick`/
  `blur`を比較し、bubbling/capture/direct配線とitem identity帳簿の組み合わせを
  決める。`event.currentTarget`を直接要素と同じに保てるproxy/adapterの是非も、
  native event identityやreadonly性を壊さないかを含めて検証する。
- ハンドラが実際に値を変えなかった場合でも `update_*` が走る
  「correct-but-wasteful」な挙動を、将来的に値の変化を見て skip する
  最適化に寄せるべきか。現状はテキストマーカー更新が冪等なので実害はない。
- `class`/`value` 等の非ハンドラ属性のサポート。
