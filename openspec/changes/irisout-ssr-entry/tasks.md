## 1. 公開入口

- [ ] 1.1 `irisout/ssr`と`irisoutSsr()`の型・exportsを追加し、既存tarballから解決できることを確認する
- [ ] 1.2 Vite+設定で指定したルート部品をビルド時に処理し、SSR用virtual moduleを生成できることを確認する

## 2. SSR生成

- [ ] 2.1 `render(input)`が要求ごとにHTMLとJSON直列化可能stateを返し、局所signalを要求間で共有しないことを確認する
- [ ] 2.2 入力、テキスト、属性、条件分岐、局所signalを含むCounter相当の固定ページを2入力で描画する
- [ ] 2.3 module共有状態、外部module、対応外記法を`compile:` scope limit診断で拒否することを確認する
- [ ] 2.4 イベント、`onMount`、`effect`、`use=`がSSR中に実行されず、クライアント生成物へだけ残ることを確認する

## 3. hydrateと回帰

- [ ] 3.1 SSR HTMLへstateを渡して既存DOMをhydrateし、初期HTMLを再生成せずに入力・見出し・文字数が一致することを確認する
- [ ] 3.2 A/Bの並行要求、失敗要求後の正常要求、404・503でstateが混ざらないことを確認する
- [ ] 3.3 `bun run check`、`bun run test`、`bun run build:packages`、`bun run pack:smoke`とOpenSpec検証が成功することを確認する
