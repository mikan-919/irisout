## 1. Authoring and analysis

- [x] `onMount`のroot movement-zone構文を追加する
- [x] callbackとcleanupの形を解析し、signal書き込みを接続する
- [x] 子component・構造unitのscope limitを維持する

## 2. Generated lifecycle

- [x] mount/hydrate後のcallback実行を生成する
- [x] cleanupの逆順、一回実行、初期化失敗時の回収を生成する
- [x] 未使用生成物へonMount専用コードを追加しない

## 3. Contract and verification

- [x] `types/jsx.d.ts`を更新する
- [x] ADR-0025、README、STATUS、ROADMAPを更新する
- [x] 受入テスト、型検査、OpenSpec検証、全テストを実行する
