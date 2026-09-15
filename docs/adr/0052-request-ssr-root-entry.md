# ADR-0052: request SSRのルート入口とhydrate契約

- **状態**: 決定済み・実装済み（実運用未検証）
- **日付**: 2026-09-14

## コンテキスト

現行の`irisout/vite`はビルド時に初期HTMLを生成し、ブラウザでhydrateするclient
buildの入口である。ADR-0038により、要求ごとの入力と状態を扱うrequest SSRは現行入口へ
暗黙に追加しないことが決まっている。共有Playgroundの保存ページを要求ごとに表示するには、
運営側の部品をビルド時に処理するサーバー専用の入口が必要になる。

## 決定

- 公開パッケージは`irisout`一つを維持し、副入口`irisout/ssr`とVite+用の
  `irisoutSsr()`を追加する。これはADR-0047の単一公開パッケージの範囲内である。
- `irisoutSsr()`へ指定するのはルート部品一つとする。指定されたルート部品の初期描画全体を
  サーバーで実行し、部品単位のSSR指定と自動判定は持たない。
- 初期SSRの入口は単一moduleに限る。`compileProject()`へ相対moduleが含まれる場合は、
  関数宣言だけのmoduleでも`compile:` scope limitで拒否する。
- サーバー側の描画契約は`render(input) -> { html, state }`とする。`input`と`state`は
  JSONへ直列化できる値だけを含め、要求ごとに生成して要求終了後に破棄する。許可する値は
  配列、`null` prototypeまたは`Object.prototype`のobject、有限number、string、boolean、`null`
  に限る。公開`serializeSsrState()`は`<`等をescapeしてscript要素へ安全に埋め込める文字列を返す。
- `state`は初期HTMLと対応するブラウザ用生成物へ渡し、`hydrateComponent(container, state)`で
  既存DOMへhydrateする。SSR生成物の`hydrateComponent()`と`mountComponent()`のstate引数は
  `render()`が返したstate専用とし、生inputとの推測を行わない。局所signalの初期値はstateから
  復元し、初回表示のための再取得やhydrate時の再評価は契約に含めない。
- イベント処理、`onMount`、`effect`、`use=`はクライアント専用とし、SSR中に実行しない。
- 初期SSRの対応記法は入力、テキスト、属性、条件分岐、一覧、ルート部品直下の局所signalとする。
  構造unit内の`signal()`/`derived()`はcompile scope limitで拒否する。module共有状態は要求間の
  分離を保証できないため、相対moduleと合わせてコンパイル診断で拒否する。
- ルート入力のbindingがSSR生成物の内部名と衝突する場合は、曖昧な出力を作らず`compile:` scope
  limitで拒否する。
- SSRの入口へ指定できるのは運営側が管理する部品だけとする。投稿されたJSXをこの入口へ
  渡す契約は作らない。

## 検討した代替案

- **既存の`irisout/vite`を要求ごとに切り替える**: 静的client buildと要求単位のstate所有を
  同じ入口へ持ち込み、ADR-0038の境界を壊すため採用しない。
- **部品ごとにSSR対象を推測する**: コンパイラの意味推論と実行環境の判定が必要になり、
  未対応記法を黙ってクライアントへ送る危険があるため採用しない。
- **module共有状態をそのまま再利用する**: 要求間で値が残るため初期SSRでは拒否する。
- **サーバーでイベントやライフサイクルを実行する**: DOMとブラウザ権限がない環境での動作を
  定義する必要があり、共有ページの初期表示に不要なため採用しない。
- **相対moduleをSSRで再利用する**: objectや関数閉包だけでなく関数宣言も単一要求へ閉じ込める
  契約がないため、初期版では純粋関数に見えるものも含めて拒否する。
- **構造unitごとのsignal stateをSSRで持つ**: list itemごとのstate識別とhydrate搬送が未決定のため、
  初期版では構造unit内の`signal()`/`derived()`を拒否する。

## 結果

利用者はVite+設定へ`irisoutSsr()`を追加してSSR対象のルートを明示できる。SSR可能性の
自動判定はなく、対応外の記法はコンパイルエラーになる。既存のブラウザ入口、生成HTML、
hydrate契約は維持される。404・503で正常ページ用stateを生成しない判定は要求処理層の契約へ
移管する。
