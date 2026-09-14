## 1. 公開入口

- [x] 1.1 `irisout/ssr`と`irisoutSsr()`の型・exportsを追加し、既存tarballから解決できることを確認する
- [x] 1.2 Vite+設定で指定したルート部品をビルド時に処理し、SSR用virtual moduleを生成できることを確認する

## 2. SSR生成

- [x] 2.1 `render(input)`が要求ごとにHTMLとJSON直列化可能stateを返し、ルート部品直下の局所signalを要求間で共有しないことを確認する
- [x] 2.2 入力、テキスト、属性、条件分岐、一覧、ルート部品直下の局所signalを含むCounter相当の固定ページを2入力で描画する
- [x] 2.3 module共有状態、相対module、外部module、対応外記法を`compile:` scope limit診断で拒否することを確認する
- [x] 2.4 イベント、`onMount`、`effect`、`use=`がSSR中に実行されず、クライアント生成物へだけ残ることを確認する

## 3. hydrateと回帰

- [x] 3.1 SSR HTMLへrender()のstateを渡して既存DOMをhydrateし、初期HTMLを再生成せずに入力・見出し・文字数が一致することを確認する。raw inputは受け付けない
- [x] 3.2 coreのA/B並行要求と失敗要求後の正常要求でstateが混ざらないことを確認する。404・503で正常ページ用stateを生成しない判定は要求層changeへ移管する
- [x] 3.3 `bun run check`、`bun run test`、`bun run build:packages`、`bun run pack:smoke`とOpenSpec検証が成功することを確認する
