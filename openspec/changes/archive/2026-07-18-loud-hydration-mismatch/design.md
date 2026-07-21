# loud-hydration-mismatch design

## Context

`mount()`/`hydrate()`(`src/runtime.ts`)は `data-iris-id` 要素を収集して
Map を返すだけで、何が「あるべき」かを知らない。知っているのは生成コード
側(コンパイル時に確定したマーカー ID 集合)。現状は取得側が全箇所
`?.`/`if (__el)` で防御しており、不一致は無症状のまま機能欠損になる。

## Goals / Non-Goals

**Goals:**

- DOM と生成コードの不一致を mount/hydrate の時点で1回、明示的エラーとして
  検出する。

**Non-Goals:**

- 欠落からの回復・部分ハイドレーション(不一致は常にバグ)。
- `?.`/`if (__el)` ガードの削除(出力スナップショットの無用な churn を
  避ける。検証導入後は実質デッドガードだが害はない)。
- 複数 mount 問題(`__markers__` モジュールスコープ共有、STATUS.md 既知
  制約)の解決。

## Decisions

### D1: 検証はランタイム側、生成コードは ID リストを渡すだけ

`mount(container, html, expectedIds)` / `hydrate(container, expectedIds)` に
シグネチャを拡張し、収集後に `expectedIds` のうち Map に無いものを集めて
`throw new Error('hydrate: missing marker(s): m3, m7 — initial HTML does not match compiled output')`
する。検証ループを生成コードへインライン展開するより出力が縮む
(ADR-0004)。生成側は
`const __MARKER_IDS__ = ["m0","m1",...];` を1行出力して両関数へ渡す。

検証対象はテキスト/リスト/条件分岐/アクションのトップレベルマーカー全部
+ハンドラのみのマーカー(`ctx.handlers` の markerId)。factory 内部の
ローカルマーカーは `<template>` 由来で欠落し得ないため対象外。

### D2: throw であって console.error ではない

不一致は続行しても正しく動かない(更新が届かない DOM を放置する)ので、
即 throw が正直。SSR 側の HTML とコンパイル済み JS のバージョン不整合を
最速で表面化させる。

## Risks / Trade-offs

- [expectedIds 引数の追加は既存呼び出しの破壊的変更] → `mount`/`hydrate`
  の呼び出し元は生成コードと test のみ。引数省略時(undefined)は検証
  スキップにして後方互換を保つ。
- [golden スナップショット変化] → mount/hydrate 行と `__MARKER_IDS__` 1行
  のみの想定内 diff。サイズ予算(3x)内に収まることを確認する。
  → **2026-07-18 実装時に外れた**: 検証コードがランタイム固定費として
  `dist/app.js` に乗り 2.78x → 3.66x。生成コード側の肥大化ではないため、
  ユーザー判断で予算係数を 4x へ引き上げ(generated-output-regression-tests
  への spec delta 参照。係数を締め直すのは M6)。
