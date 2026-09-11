## Why

`collection()`の廃止は公開記法の互換性を壊すため、公開済み`0.1.1`と同じ版系列では配布できない。次版を`0.2.0`として準備し、移行方法と梱包物の検査を揃える。

## What Changes

- 公開パッケージのソース版を`0.2.0`へ更新する。
- 変更履歴、実装状況、ロードマップへ`collection()`からキー付き`signal`への移行を記録する。
- 梱包物検査でキー付き`signal`の型検査、項目更新、生成結果を確認する。
- irisout開発スキルのキー付き状態記法を`signal(initial, keyOf)`へ更新する。
- npm公開と外部協力者への連絡は行わない。

## Capabilities

### New Capabilities

なし。

### Modified Capabilities

- `single-package-distribution`: ローカル梱包物検査へキー付き`signal`の公開契約を追加する。
- `irisout-agent-skill`: スキルが廃止済み`collection`ではなくキー付き`signal`を案内するようにする。

## Impact

`packages/irisout/package.json`、変更履歴、梱包物検査、現行文書、スキル、仕様が対象となる。npm上の`0.1.1`と公開版検査は変更しない。
