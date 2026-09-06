## compiler

- [x] `use=`をlist item・conditional branchのbodyへ収集し、任意の構造unit深さで保持する。
- [x] actionのwrite set・result依存・local/ancestor update ownerを変換する。
- [x] actionを持つfactoryへmount/update/destroyを生成し、子unitのライフサイクルを接続する。
- [x] keyed reorder・item update・item removal・branch switchで初期化と破棄の回数を固定する。

## runtime

- [x] action用List reconcile、List全体mount、List全体destroyを追加する。
- [x] 初期化途中と破棄例外で全resourceを処理し、最初の例外を再送出する。
- [x] actionを使わない生成物が従来runtime経路とcounterサイズ予算を維持することを確認する。

## fixture and tests

- [x] list item actionの生成・更新・keyed reorder・削除・root unmountを試験する。
- [x] conditional actionのbranch生成・切替・focus・破棄を試験する。
- [x] 3階層以上のネスト、local signal、複数instance、stale callbackを試験する。
- [x] destroy例外と初期化途中の失敗でcleanupが継続することを試験する。
- [x] `notes.jsx`へconditional input focusと外部listenerの登録・解除例を追加する。
- [x] examples production buildを実ブラウザで操作確認する。

## documentation and verification

- [x] README、STATUS、ROADMAP、CONCEPT、ADR-0011/0013/0022/0023を更新する。
- [x] canonical OpenSpecとこのchangeのspec deltaを更新する。
- [x] `vp check`、`vp test --run`、`vp build`、OpenSpec validationを実行する。
- [x] size delta、未使用action fixtureの出力、残るscope limitを記録する。
