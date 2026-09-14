## Why

公式サイトと共有Playgroundの実装へ進む前に、文書の正本、初回掲載範囲、対象版、SSRと共有の境界を固定する。決定がないまま実装すると、既存のclient build契約と新しいrequest SSRが混ざり、本文と例の二重管理が生じる。

## What Changes

- `docs/getting-started.md`を導入文書の正本として、サイト側から同じ入力を参照する。
- 初回の文書8分類とCounter・List・SVGの公式例を固定する。
- `irisout/ssr`、`irisoutSsr()`、`render(input) -> { html, state }`のSSR境界を固定する。
- SSR対象を指定したルート部品の初期描画全体に限定し、イベント、`onMount`、`effect`、`use=`をクライアント専用にする。
- `input`と`state`をJSON直列化可能な値に限定し、module共有状態と投稿JSXのサーバー実行を拒否する。
- アカウントなしの限定公開、新規ID、管理鍵による削除を初回共有の契約にする。
- 実装段階ごとのOpenSpec changeを作成する。

## Capabilities

### New Capabilities

なし。これは実装前の設計判断と作業単位を記録する変更である。

### Modified Capabilities

なし。

## Impact

計画文書、ロードマップ、ADR-0052〜0054、後続のOpenSpec change一覧を更新する。コンパイラ、Vite連携、サイト、保存APIの実装は後続changeで行う。
