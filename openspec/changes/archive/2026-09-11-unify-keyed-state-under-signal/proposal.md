## Why

通常の状態とキー付き配列状態で宣言関数が分かれており、作者が状態の種類ごとにAPIを選ぶ必要がある。`signal`へキー指定と項目更新を統合し、状態宣言を一つにする。

## What Changes

- `signal(initial, keyOf)`でキー付き配列状態を宣言できるようにする。
- キー付きsignalへ`update(key, updater)`を提供し、既存の項目直接更新を維持する。
- module共有のキー付き状態も`signal(initial, keyOf)`で宣言する。
- **BREAKING** 作者向け`collection()`を廃止する。

## Capabilities

### New Capabilities

- `keyed-signal`: キー付き配列signalの宣言、置換、項目更新、識別子検査を規定する。

### Modified Capabilities

- `module-shared-state`: module共有collectionをmodule共有キー付きsignalへ置き換える。
- `multi-file-module-composition`: module共有状態の受理条件とシナリオをキー付きsignalへ置き換える。
- `authored-jsx-type-checking`: `signal`のキー付き配列用オーバーロードを追加し、`collection`型宣言を削除する。

## Impact

作者向けJSX、コンパイラの宣言解析、ビルド時検出、共有状態生成、型宣言、利用例、試験、文書が対象となる。生成コード内のキー索引と一覧項目直接更新の方式は維持する。
