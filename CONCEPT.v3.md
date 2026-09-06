# irisout v3 コンセプト

## 目的

irisout は React の代替ではありません。

その目的は、JSX の宣言的な開発体験を保ちながら、ブラウザへ届けるコードを
アプリケーションに必要な処理だけへ縮めることです。

静的に確定できるものはコンパイル時に解決し、実行時にしか扱えない動的構造は
最小限のコードで管理します。ランタイムをゼロにすること自体は目的にしません。

---

## 設計原則

- 可能な限り静的 HTML を生成する。
- 更新は仮想 DOM を経由せず、実 DOM に直接適用する。
- コンポーネント境界と、実行時に不要な authoring API はビルド後に消す。
- 静的に決められる依存関係と更新先はコンパイル時に確定する。
- 実行時コードは、必要な機能だけを含む最小限のものにする。
- コードのインライン化やランタイムレスを目的化せず、速度・サイズ・メモリと
  実装の単純さを実測して最適な形を選ぶ。

判断基準は次の問いです。

> この UI に必要な仕事だけを、ブラウザで最も小さく素直に実行するには
> どう書くか？

「経験豊富なエンジニアが Vanilla JavaScript で手書きするなら」という従来の
基準は維持します。ただし、人間なら共通化する処理まで無理に展開しません。
共有した方が小さく速い処理は、小さなヘルパーとして共有できます。

### authoring API を貫く3原則(ADR-0011)

- **穴のない宣言**: 「あとで埋まる箱」は存在しない。UI より前には完成した
  値だけが置かれ(const/signal — 生まれた瞬間から値を持つ)、UI より後には
  中身の供給だけが置かれる(function 宣言 — UI が宣言した名前に差し込まれる)。
  `render()` がその境界線である。
- **プレースホルダーの向き**: 名前は UI が宣言し、後段が差し込む。
  `{count()}`、`onClick={handle}`、`use={setup}`は同じ向きを持つ。
- **位置的リアクティビティ**: リアクティブ性は「どう読むか」ではなく
  「どこに書いたか」でコンパイル時に決まる。実行時の汎用購読機構を前提に
  せず、静的に確定できる更新経路は専用コードへ変換する。

この3原則も目的ではなく、APIの一貫性を守る現在の判断です。実用性や生成物の
品質を妨げる具体例が得られた場合は、ADRで改訂できます。

入力値の双方向結合は`bind:value={text}`で表す。これは`input`、`textarea`、`select`の
`value` propertyと文字列signalを接続する専用の省略記法であり、コンパイラが
value propertyの読み取り、inputイベントの書き戻し、既存の更新経路を確定する
(ADR-0040)。任意のsetterやメンバー式を実行時に推測する汎用機構は導入しない。

同一ファイルcomponentの`children` propは、`<Panel>...</Panel>`の子ノードを
component本体のJSX要素にある`{children}`へコンパイル時に展開する。実行時のprops
objectやslot runtimeは追加せず、展開後の子ノードを既存のrender-tree解析へ渡す。
直接の子位置以外での`children`参照はscope limitとする(ADR-0041)。

---

## 直接 DOM 更新と更新粒度

「直接 DOM 更新」は、「状態変更のたびに関連する DOM API を即座に一回ずつ
呼ぶ」という意味ではありません。仮想 DOM ツリーを構築して比較せず、最終的な
反映先が実 DOM である、という境界を示します。

コンパイラと最小ランタイムは、意味を変えない範囲で更新粒度を最適化できます。

- 同じ状態変更に由来する複数の DOM 更新を一つの更新関数へまとめる。
- 同一ターンの複数書き込みをバッチし、不要な中間状態の反映を省く。
- Listでは、keyed diff、DOMノードの再利用、挿入・移動・削除を一単位として
  扱う。
- itemごとのクロージャやイベントリスナーより共有処理が有利で、native eventの
  意味同等性も保てるなら、イベント委譲や共通ハンドラを使う。
- 更新対象が静的に確定する箇所では、従来どおり専用の直接更新コードを生成する。

構造ユニットは深さを固定値で止めず、各instanceのfactoryへ再帰的に展開する。
factoryは自身のDOM範囲、局所状態、binding cache、内側Listのkeyed Map、更新処理を
所有する。`use=`があるfactoryはactionの初期化・update・destroyも所有する。
内側unitが祖先の局所状態を読む場合は、祖先factoryの更新から内側unitへ接続する。
branchを再生成したときは新しいcacheを作り、別instanceの前回値を使って更新を省略しない。
component treeの共有依存はinstance単位のcontextとして扱う。`createContext`で宣言した
compile-time keyを`provideContext`/`useContext`へ静的に接続し、consumerは最も近いprovider
またはdefault式へ置換する。構造unitの動的provider treeとPromiseLikeの非同期contextも
この静的境界へ限定する。汎用context registryや汎用storeは導入せず、module共有stateは
`compileProject`の直接`signal`/`derived`だけを参照時に出力し、未使用時の生成物へ固定費を載せない。

イベント配線は、速度やJavaScriptヒープだけでなく、`target`、`currentTarget`、
event objectの同一性、バブル・捕捉、非バブルイベントの意味を含めて選ぶ。実Chromium
計測では委譲方式のリスナー数とヒープが小さかったが、`blur`、`currentTarget`、
event objectに差が出たため、現行の本番既定は直接配線である(ADR-0021)。

最小の更新粒度が常に最速とは限りません。採用する粒度は実ブラウザ上の速度、
メモリ、生成コードサイズを測って決めます。

---

## ランタイムの境界

irisout はランタイムの存在を禁止しません。Listや条件分岐、component instanceの
lifecycleなど、実行時にしか決まらない構造を正しく効率的に扱うための小さなコードを
許容します。汎用lifecycle runtimeを暗黙に常駐させるのではなく、生成された
component instanceが明示的な`unmount()`を持ち、`use=` actionの`destroy`を
top-levelまたは構造unitの所有者factoryだけが保持します。keyed reorderでは同じ
factory instanceを再利用し、key脱落・branch切替・祖先unit破棄時だけdestroyします。

一方、次のようなアプリケーション全体を支配する汎用実行基盤は前提にしません。

- 仮想 DOM
- Fiber のような汎用的な作業ツリーとスケジューラ
- 実行時にアプリケーション全体を再構築するリアクティブグラフ
- 未使用機能まで常駐させる包括的なフレームワークランタイム

ランタイムコードを導入する場合は、次を満たす必要があります。

1. コンパイル時だけでは解けない具体的な責務がある。
2. 使用した機能に必要なコードだけが出力へ含まれる。
3. 専用コードの重複展開より、速度・サイズ・メモリまたは保守性で有利である。
4. hidden workを増やさず、生成コードから挙動を追跡できる。
5. 実ブラウザのベンチマークで判断できる。

構造unitのaction lifecycleは汎用購読機構ではない。コンパイラが生成したfactory handle
(`el`・`update`・`mount`・`destroy`)をList/conditionalの既存状態管理へ接続する。
mountはDOM挿入後に子unit、同じunitのactionの順で実行し、destroyは子unit、同じunitの
actionの逆順で実行する。これは外部listenerなど作者が明示したresourceの所有期間を
DOM instanceへ合わせるための専用経路である。

---

## ビルド戦略

irisout は compiler-first なシステムです。

コンポーネント定義のビルド時実行と静的解析を組み合わせ、JSX構造、状態、依存、
更新先を可能な限り事前に確定します。目的は完全な JavaScript コンパイラを作る
ことではなく、良い実行コードを生成するために必要な情報だけを抽出することです。

責務はおおむね次のように分けます。

### コンパイラ

- 静的 HTML の生成
- JSX構造と式の解析
- 状態から更新先への依存関係の確定
- 不要なコンポーネント境界とauthoring APIの除去
- 単純なテキスト・属性更新の専用コード生成
- 必要な構造ランタイムの選択

### 最小ランタイム

- ListのkeyとDOMノードの対応、再利用、移動、削除
- 条件分岐など動的構造の生存期間
- component instanceのmount/hydrate/unmountと、top-level・構造unit内`use=` actionの明示的なdestroy
- 実測で有利かつnative eventの意味同等性を確認した更新のバッチやイベント委譲
- その他、コンパイル時には完結できない処理(ただし汎用lifecycle/effect runtimeは含めない)。
  ルートcomponentの明示的な`effect`はADR-0026に従い専用`update_*()`へ静的に接続する
  ため、この例外には含めない。
- contextはADR-0027〜0029に従いコンパイル時に式置換して扱うため、専用のruntime registryを
  追加しない。module共有stateはADR-0030/0037/0039の直接signal/derived/collectionに限り、
  参照された生成物へ出力する。汎用provider registry、非同期schedulerは対象外とする。

責務は固定ではありません。同じ仕事を専用コードとして生成する場合と共有
ヘルパーへ任せる場合を比較し、より小さく速く単純な方を選びます。

---

## コード生成

静的に確定した依存関係は、引き続き実 DOM を操作する専用更新コードへ
コンパイルします。

```js
let count = 0

function updateCount() {
  countText.data = count
  title.textContent = count
}
```

Listのように共通アルゴリズムが有利な箇所では、生成コードから小さな構造
ヘルパーを呼び出して構いません。それは仮想DOMやFiberの導入を意味しません。
コンパイラは更新先とitem生成処理を既に知っており、ヘルパーは動的な差分適用
だけを担当します。

---

## 哲学

irisout が避けるのはランタイムそのものではなく、アプリケーションに不要な
汎用機構です。

理想的な出力は「すべてをインライン化したコード」でも「ランタイムが0バイトの
コード」でもありません。静的な部分は消し込み、動的な部分には必要十分な共有
処理を使い、UIが要求する仕事だけを残したコードです。

価値は no runtime ではなく、次の組み合わせにあります。

- JSXによる宣言的なauthoring
- compiler-firstな静的解決
- 仮想DOMを介さない直接DOM更新
- 実測に基づく更新粒度の最適化
- 使用した機能にだけ支払う最小限の実行時コード
