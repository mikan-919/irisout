# ADR-0072: 初期HTMLを配るclient束からmountを外す

日付: 2026-10-19。状態: 採用。

`irisout()` Vite pluginで作るclient束は、`index.html`へ初期HTMLを焼き込み、仮想moduleから`hydrateComponent`だけを呼ぶ。この構成ではmount用の経路(`mount`・`mountWithRanges`・mount時の初期HTML文字列)は決して使われないにもかかわらず、生成moduleが`mount`をimportし、`__INITIAL_HTML__`を複製し、`mountComponent`をexportしていた。公式js-framework-benchmarkのキー付き一覧でBrotli転送量5,148→4,403バイト以下(-15%)を事前目標に分解すると、起動時JSの`__INITIAL_HTML__`1,234バイトを含む生成側の未使用経路が最大の削減対象だった。

`compileProject`/`compile`へ`clientEntry?: 'full' | 'hydrate'`を足し、既定は`full`のままとする。`hydrate`では`generateModule`が`mount`import・`__INITIAL_HTML__`・mount用分岐・`mountComponent`exportを出さず、`hydrate`と`unmount`、`update_*`だけを残す。pluginのclient buildは`hydrate`を指定し、SSRや仮想moduleなしのclient専用buildは従来どおり`full`を使う。`hydrate`は`hydrateWithRanges`の選択、marker検証、更新経路を`full`と共有するため、実行時の挙動は変わらない。

公式測定器の同一入力で、Brotliは4,948→4,692バイト(生14,141、-12.8%)となった。さらに一覧の生成コードで未使用の探索・範囲helperを出さないようにし、benchmarkの本番buildでmodulepreload polyfillを切った(この構成は動的importがなく、測定するChromiumはネイティブに解釈する)結果、Brotli 4,433バイト、転送量の集計はBrotli 5.20→4.70KiBとなった。事前目標の4,403バイトには30バイト届かない。残りはランタイムの`reconcileListMap`/`reconcileList`の重複で、安全な共通化はBrotliで悪化し、通知先がある場合の交換を汎用照合へ落とす削減は品質を下げるため採らない。鍵重複の診断文を短くすれば届くが、原因の切り分けを悪くするため採らない。

採らなかった案: client束でも`mount`を残す案は未使用経路の転送を続けるため採らない。`hydrate`専用の別生成器を作る案はmarker検証と更新経路を二重化するため採らない。plugin側で常にpolyfillを切る案は動的importを使うアプリの古いブラウザー互換を落とすため採らない。mount側の初期HTMLを遅延評価する案は、mountを使うclient専用buildの速度を測らずに変えるため採らない。
