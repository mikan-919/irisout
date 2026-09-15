## Context

現行の`irisout/vite`はビルド時の静的HTMLとブラウザhydrateを提供し、要求ごとのSSRは提供しない。公式サイトには既存の`docs/getting-started.md`と`app/web`のCounter・List・SVGがある。共有Playgroundでは投稿JSXをサーバーで実行せず、運営側の部品だけをSSRする必要がある。

## Goals / Non-Goals

**Goals:**

- 初回公開で扱う文書、例、版、URL、SSR、共有の境界を実装前に追跡可能にする。
- ADRと後続OpenSpec changeの依存関係を計画へ記録する。

**Non-Goals:**

- コンパイラ、Vite連携、保存API、サイト画面の実装。
- SSR APIの実装詳細、配信先、保存量、頻度制限の最終値。

## Decisions

- SSRの単位とhydrate契約はADR-0052へ分ける。
- 文書正本と初回掲載範囲はADR-0053へ分ける。
- 共有範囲と投稿コード境界はADR-0054へ分ける。
- 後続実装は文書SSG、ブラウザ入口、隔離実行、SSR入口、保存共有、SSR公開のchangeへ分割する。

## Risks / Trade-offs

- [公開範囲が広がる] → 初回の文書と例を固定し、追加は別changeへ分ける。
- [SSR契約がclient buildへ混ざる] → `irisout/ssr`と`irisoutSsr()`を別入口にする。
- [本文が二重管理される] → `docs/getting-started.md`を正本として参照生成する。

## Migration Plan

第0段階の記録として保存する。実装は`site-docs-ssg`から開始し、SSRと共有のchangeは依存条件を満たしてから着手する。
