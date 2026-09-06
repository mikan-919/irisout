## compiler

- [x] 構造unitとinline子componentのeffectを収集する。
- [x] factoryの初回実行、依存再実行、cleanup、初期化失敗経路を生成する。
- [x] root/local signal依存を既存marker・factory更新へ接続する。

## fixture and tests

- [x] list item local signal effectの再実行と削除cleanupを試験する。
- [x] list item/conditional inline child effectの所有と破棄を試験する。
- [x] 未使用unitにeffect専用生成物がないことを試験する。

## documentation and verification

- [x] ADRとcanonical OpenSpecを更新する。
- [x] 構造effectの試験、型検査、OpenSpec検証を実行する。
- [ ] 全試験、check、buildを最終検証で実行する。
