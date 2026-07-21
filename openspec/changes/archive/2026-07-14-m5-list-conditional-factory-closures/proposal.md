## Why

irisoutは現在、条件分岐・リストレンダリングを実装しておらず(`STATUS.md`の既知の
制約)、M4(静的host属性)・M4.5(authoring APIゾーン化)・ADR-0009(ハンドラ
statement body)が完了した今、TodoMVCのようなアプリを一通りコンパイルするための
最後の主要な欠落機能になっている。ADR-0005は設計方針(factory-per-unitクロージャ
+ keyed reuse)を既に決定済みだが実装は未着手のままで、ロードマップ上も
「M4→API変更→ADR-0009→性能ベンチ→M5」の実装順序でM5が次の主要マイルストーンと
位置づけられている。

## What Changes

- `<template>` + `content.cloneNode(true)`によるスタンプ機構を実装する
  (文字列HTML生成ではなく)。
- リストアイテム/条件分岐ブランチごとに、DOM取得・ローカル状態変数・
  `update_*`・`addEventListener`登録をまとめた「factory関数」を生成する
  (ADR-0005 決定2)。
- リスト更新をkeyed reuseに変更する: 既存keyはfactoryが返したハンドルを
  再利用し、DOM再生成やイベントリスナーの貼り直しをしない(ADR-0005 決定3)。
- 条件分岐(if/三項)のレンダリングも同じfactoryパターンで生成する。
- 明示的なアイテムteardownフックは実装しない(ADR-0005 決定4、GCに委ねる)。
- `examples/todomvc.jsx`のUNRESOLVED(04)〜(08)のうち、本changeのスコープに
  含めるものを設計時に確定する(下記Capabilities参照。ネストした構造
  ユニット(06/07)を含めるかどうかはdesign.mdで判断する)。

## Capabilities

### New Capabilities
- `list-conditional-rendering`: リスト(keyed reuse)・条件分岐の
  factory-per-unitクロージャによるレンダリング。ADR-0005の実装。

### Modified Capabilities
- `component-authoring-zones`: render()マーカーの配置対象に「リスト/条件
  分岐が生成する動的な子要素」が加わる可能性がある場合のみ、ゾーン配置
  ルールの要求を更新する(design.mdで実際に規約変更が要るか確認する)。

## Impact

- 影響コード: `src/codegen.ts`(スタンプ機構・factory関数生成・keyed reuse
  更新ロジック)、`src/compiler/render.ts`(`.map()`・条件分岐JSXの分類、
  scope limitの対象拡大/縮小)、`src/compiler.ts`(全体のコンパイル
  パイプライン)。
- `examples/todomvc.jsx` / `examples/todomvc.handwritten.js`が目標
  フィクスチャ。ネストスコープを含めない場合、フィクスチャ自体の
  UNRESOLVED注記を更新する。
- `bench/listener-strategy.ts`の実測(直接addEventListener方式)がそのまま
  実装方針の裏付けとして使える。
- `perf-bench-todomvc-vs-react`change(性能ベンチ)の結果が出ていれば、
  design.mdの判断材料として参照する。
