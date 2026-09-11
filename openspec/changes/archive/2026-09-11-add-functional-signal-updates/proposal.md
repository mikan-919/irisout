## Why

状態設定が`signal(next)`と`.update(key, updater)`に分かれ、配列だけ宣言時のキー選択を要求している。全状態を`signal(next)`と`signal(previous => next)`へ統一する。

## What Changes

- `signal(previous => next)`を追加する。
- **BREAKING** `signal(initial, keyOf)`と`.update(key, updater)`を削除する。
- 配列更新を一覧の全体再調整へ統一し、識別と要素再利用をJSXの`key`へ限定する。
- キー付き状態専用の実行時処理と生成経路を削除する。
- ソース版を`0.2.1`へ更新する。

## Capabilities

### New Capabilities

なし。

### Modified Capabilities

- `authored-jsx-type-checking`: signal設定関数へ関数形式を追加し、キー付きオーバーロードを削除する。
- `keyed-signal`: キー付きsignalの宣言と項目更新を削除する。
- `module-shared-state`: module共有signalで関数形式更新を受理し、キー付きsignalを削除する。
- `multi-file-module-composition`: module共有配列を通常のsignalとして扱う。
- `single-package-distribution`: 梱包物検査を関数形式の配列signalへ変更する。
- `irisout-agent-skill`: 配列更新を関数形式で案内する。

## Impact

作者向け型、コンパイラ、実行時処理、一覧試験、利用例、梱包物、文書、仕様が対象となる。npm公開は行わない。
