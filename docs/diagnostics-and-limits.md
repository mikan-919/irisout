---
title: 診断と対応範囲
description: scope limitの読み方、調査方法、現在の主な制約を説明する
slug: diagnostics
section: 診断と対応範囲
order: 1
---

# 診断と対応範囲

irisoutは静的に安全な更新経路を作れない構文を推測で処理せず、コンパイル時に拒否する。意図的な未対応範囲は`compile: ... (scope limit)`と表示される。

## 診断の読み方

診断には対象ファイル、行、列、拒否した構文が含まれる。まずその位置を小さい式へ分け、対応する記述へ置き換える。

- 条件分岐は`if`文ではなく、JSX内の三項演算子または`&&`にする。
- 一覧はJSX内で状態へ直接`.map()`し、項目へ`key`を付ける。
- DOMを直接扱う処理は`use=`または`onMount`へ置く。
- propsは引数で単純に分割代入し、別名やspreadを避ける。

## 主な境界

- ルート部品は参照されていないトップレベル関数を一つだけ置く。
- 状態宣言は`render()`より前、イベントとライフサイクルは後に置く。
- 部品の再帰、任意の部品値、循環moduleは扱わない。
- ブラウザ内コンパイラは相対import、外部import、ファイル読込みを扱わない。
- Motion拡張は`layout`、`layoutId`、`initial`、`animate`、`transition`を扱い、`variants`、`exit`、gesture属性は扱わない。
- 要求単位SSRではサーバーでイベント、ライフサイクル、`use`を実行しない。

## 不具合を報告する

次を残すと原因を切り分けやすい。

1. 最小化した元のJSX
2. 診断全文
3. `irisout`、Vite+、ブラウザの版
4. 開発時か本番ビルド時か
5. 期待したDOMと実際のDOM

実装済み範囲の一覧は[STATUS.md](https://github.com/mikan-919/irisout/blob/main/STATUS.md)、設計判断は[ADR一覧](https://github.com/mikan-919/irisout/tree/main/docs/adr)を参照する。
