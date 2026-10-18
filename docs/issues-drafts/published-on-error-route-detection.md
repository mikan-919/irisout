# 公開版で子ルーターへonErrorを追加すると経路を検出できない

観測日: 2026-10-18。npm公開版0.3.7の試行Bで観測した。現行ソースでの再現と内部原因は未確認である。

実装役の原文:

> 原因調査用に追加したpages.onErrorがルートの認識に影響したと推測。Hono標準APIでの診断追加がirisoutのメタ情報と両立する条件は公開文書にない。

## 再現

[比較用の最小再現](../../fixtures/published-incident-dogfood/attempts/b/repro/on-error-routes.mjs)を公開版0.3.7とHono 4.13.13の隔離導入先で実行する。

```sh
bun repro/on-error-routes.mjs
```

`createFileRouter()`で作った`pages`へ`pages.onError(...)`を登録してから`app.route('/', pages)`で接続し、`irisoutHono(app)`を呼ぶ。登録なしは受理され、登録ありは`compile: irisoutHono found no createFileRouter routes (scope limit)`で拒否された。試行Bの本番構築も同じ診断で失敗した。

## 回避と未解決

診断用に追加した`pages.onError`を取り除くと試行Bの構築は成功した。公開版で条件を縮めて再現したが、経路情報が失われるという実装役の説明は推測であり、内部原因を確定していない。現行ソースでの再現と修正、SSRの500から原因を調べる手順の整理は次の段階で扱う。

## 現行ソースでの修正（2026-10-18）

現行ソースでも登録ありの比較が同じ診断となった。Honoの`route()`は子ルーターに独自の`onError`がある場合、元の処理関数を別の関数で包む。irisoutHonoが外側の関数だけを調べていたため、元の関数に付けた経路情報を読めなかった。Honoの公開関数`findTargetHandler`で元の処理関数を取得して情報を読む修正を行った。二段の子ルーターにそれぞれ`onError`を設定した経路の検出とSSR応答を回帰試験で確認した。公開版0.3.7の観測は変更していない。
