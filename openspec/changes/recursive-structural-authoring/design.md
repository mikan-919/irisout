## 設計

### 1. 構造unitの字句スコープ

`renderStructuralUnitBody()`は、body自身のlocal declarationと祖先bodyから
参照可能な`DeclId`集合を作る。body直下のテキスト・属性はこの集合に含まれる
local signalへ依存できる。ネストしたList/conditionalの条件式・配列式が読む
local signalも同じ集合で判定する。

root signalの依存は、ネストunitの条件式・配列式なら外側unitの依存へ合流する。
一方、unit内の直接テキスト・属性がroot signalを読む場合は、templateへ値を
埋め込む専用経路がないため従来どおりscope limitとする。別unitのlocal signalは
生成されたfactoryの字句スコープから見えないため拒否する。

### 2. 所有者factoryへの更新接続

compilerはhandlerのlocal writeを、現在bodyから数えた`localUpdateLevels`として
保持する。codegenは`[現在factoryのupdate, 祖先factoryのupdate, ...]`を内側へ
渡し、handlerのlocal writeを正しい所有者へ直接呼び出す。root writeは従来の
`update_*()`またはbatchを使う。

各factoryのupdate関数名は生成名を含めて一意にする。これにより内側factoryの
handlerが祖先updateを呼んでも、同名の内側関数による名前解決の衝突を起こさない。

### 3. unit instanceのbinding cache

item factoryはList runtimeが渡す`__item__`のbinding cacheを使う。条件分岐branch
などitem引数を持たないfactoryは`{ bindings: new Map() }`をinstanceごとに作る。
branchを破棄して再生成したとき、祖先itemのcacheを共有しない。これは、同じitem値
でも新しいtemplateのplaceholderを古いcacheが「変更なし」と判定して残す問題を
防ぐ。branchのDOM、cache、local stateの生存期間をfactory instanceに揃える。

### 4. marker参照の再利用

simple item factoryの参照集合にtext marker、dynamic attribute marker、handler
markerをまとめ、各IDを一度だけ`__find__`する。handler registrationは
`__m...__`の保存済み要素を使う。generic factoryも属性とhandlerの参照集合を
共有する。生成コードの静的計数とmount中の`querySelector`をbenchで確認する。

### 5. event policy

listener benchmarkは、同じDOMと同じhandler本体で四方式を比較する。`blur`は
バブルしないためdelegatedのroot通常リスナーでは処理できない。captureは処理
できるが`currentTarget`とevent phaseが変わる。adapterは`currentTarget`を補正
できるがevent object同一性を失う。現行compilerがnative eventをそのまま渡す契約
を優先し、productionの既定はdirectとする。方式切替のN閾値や公開APIは追加しない。

### 6. authoring coverage

`apps/examples/notes.jsx`は、root state、form、tab、conditional form/hint、
List、同一ファイルcomponent、component local state、local conditional、
conditional branch内のnested Listを通常のJSXで記述する。fixtureはcompiler専用
markerやDOM手書き更新を持たない。現行のroot signal dynamic attribute制限に
合わせ、入力欄は入力eventからstateを更新する形を使い、scope limitを隠すための
構造変更は行わない。
