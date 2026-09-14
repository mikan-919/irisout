# playground-save-share Specification

## Purpose
単一JSXの編集時点を新しい限定公開URLとして保存し、アカウントなしで管理鍵による削除と応答喪失後の再送を扱える共有契約を提供する。

## Requirements

### Requirement: スナップショット保存

保存はタイトル、説明、単一JSX、対象コンパイラ版、`unlisted`の可視性を編集時点のスナップショットとして新しいIDへ記録しなければならない(SHALL)。既存IDの内容を更新してはならない(SHALL NOT)。

#### Scenario: 編集後の保存

- **WHEN** 保存済みページを編集して保存する
- **THEN** 新しい共有IDが返り、元の共有URLの内容は変わらない

### Requirement: 管理鍵による削除

保存ごとに管理鍵を発行し、閲覧URLへ管理鍵を含めず、管理鍵を検証できたDELETEだけが共有を削除できなければならない(SHALL)。

#### Scenario: 正しい管理鍵で削除

- **WHEN** 利用者が共有IDと正しい管理鍵で削除する
- **THEN** 削除は成功し、以後の閲覧は404になり、共有値は応答へ残らない

### Requirement: 保存再送の冪等性

同じrequestId、管理鍵、入力の保存再送は同じIDを返し、異なる入力の再送は409として新しい保存を作ってはならない(SHALL NOT)。

#### Scenario: 応答消失後の再送

- **WHEN** 保存応答を受け取れず同じ要求を再送する
- **THEN** 重複記録を作らず、元の保存IDを確認できる

### Requirement: 投稿JSXのサーバー非実行

保存、閲覧、削除、OGP生成のサーバー経路は保存されたJSXをコンパイルまたは実行してはならない(SHALL NOT)。

#### Scenario: 副作用を含む投稿

- **WHEN** コンパイルすると副作用を起こすJSXを保存または閲覧する
- **THEN** 副作用は実行されず、ソースは文字列としてだけ扱われる

### Requirement: 入力とOriginの境界

保存APIは公式Originからの`application/json`だけを受け付け、本文128 KiB、source 64 KiB、
title 120 Unicode code points、description 1000 Unicode code pointsの上限を読み込み時に検査しなければならない(SHALL)。
要求本文は`schemaVersion`、`title`、`description`、`source`、`compilerVersion`、`visibility`、
`requestId`以外の項目を受け付けてはならず(SHALL NOT)、初期範囲ではschemaVersion 1、
`visibility=unlisted`、配信側が許可したcompilerVersionだけを受け付ける。

#### Scenario: JSONとサイズの境界

- **WHEN** 異なるOrigin、不正なJSON、未知項目、または上限を超えるUTF-8本文を送る
- **THEN** 保存せず、403、400、415、413、422のいずれかの対象エラーを返す

### Requirement: 保存先障害と頻度制限

APIは初期値として保存10回/分・100回/日、削除30回/分の頻度制限を持ち、超過時に`429`と
`Retry-After`を返さなければならない(SHALL)。SQLiteを利用できない場合は`503`を返し、
保存成功や404へ置き換えてはならない(SHALL NOT)。共有APIの成功・失敗応答には`no-store`を付ける。

#### Scenario: 保存先停止

- **WHEN** SQLiteが停止中に保存または削除を要求する
- **THEN** `503`が返り、ブラウザ側の入力と未完了の保存要求は保持される

### Requirement: 管理鍵の保管境界

管理鍵はブラウザが256ビット以上の暗号学的乱数から生成し、サーバーはハッシュだけを保存しなければならない(SHALL)。
管理鍵は共有URL、サーバー応答、読取りデータ、ログへ含めてはならない(SHALL NOT)。削除は正しい管理鍵の
`Authorization`ヘッダーだけで認可し、正しくない鍵や形式不正の共有IDを`404`として扱わなければならない。

#### Scenario: 管理鍵を含まない読取り

- **WHEN** 保存後の記録を読み取る
- **THEN** タイトル、説明、source、版、作成日時だけを得られ、管理鍵またはその原文を得られない
