## Context

公開済み版は`0.1.1`であり、作業領域では作者向け`collection()`を削除した。ローカル梱包物検査は版番号を`0.1.1`へ固定し、通常の数値signalだけを使用している。

## Goals / Non-Goals

**Goals:** 次の破壊的変更を`0.2.0`として識別し、梱包物だけでキー付き`signal`が型検査と実行時生成を通ることを確認する。

**Non-Goals:** npm公開、公開済み`0.1.1`の上書き、内部のcollection名称変更、人間の試用実施は対象外とする。

## Decisions

ローカル梱包物の期待版は`packages/irisout/package.json`から読み取る。検査コードへの版番号重複を避け、次回の版更新で検査だけが古くなる状態を防ぐ。npm公開版検査は公開済み版を固定するため、`registry:smoke`は`0.1.1`を維持する。

梱包物の利用例にキー付き`signal`を含める。型検査だけでなく、生成JavaScriptに項目更新処理が含まれることを検査する。

## Risks / Trade-offs

- ソース版がnpm公開版より先行する → READMEに公開済み版を残し、変更履歴で`0.2.0`を未公開と示す。
- スキルの導入済みコピーがリポジトリ外に残る → リポジトリ版を正本として更新し、この作業環境のコピーを同期する。

## Migration Plan

利用者は`collection(initial, keyOf)`を`signal(initial, keyOf)`へ置き換える。`update(key, updater)`の呼び出し形は維持する。公開前にローカル梱包物検査を実行し、公開後に`registry:smoke`の固定版を更新する。
