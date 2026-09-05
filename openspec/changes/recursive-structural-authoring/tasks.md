## compiler

- [x] render.tsの構造unit深さ制限を除去し、祖先local declarationを追跡する。
- [x] compiler.tsでhandlerのlocal write ownerを現在・祖先のレベルへ変換する。
- [x] codegen.tsで再帰factory、owner update接続、unitごとのbinding cacheを生成する。
- [x] item factoryのmarker参照をイベント登録で再利用する。

## fixture and tests

- [x] TodoMVCを自然なlocal `editing`条件へ変更する。
- [x] 3階層以上の構造unitとancestor local signalの実DOM試験を追加する。
- [x] form、tabs、複数component、local state、nested Listのauthoring fixtureと試験を追加する。
- [x] `notes.jsx`のexamples buildを確認する。
- [x] TodoMVC compiler benchmarkを再実行し、lookup、listener、transfer、heap、updateを記録する。
- [x] direct/delegated/capture/adapterの複数event Chromium benchmarkを実行する。

## documentation

- [x] canonical specsとこのchangeのspec deltaを更新する。
- [x] TodoMVC benchmark reportを現行fixtureの値へ更新する。
- [x] listener benchmark reportとADR-0021のproduction判断を更新する。
- [x] STATUS.md、ROADMAP.md、CONCEPT.v3.mdの現行制約と次の作業を更新する。
- [x] jj status、check、test、OpenSpec validationを最終確認する。
