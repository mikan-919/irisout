# 設計

`apps/web/routes`を公式画面の経路正本にする。既存HTMLはhead、CSS、ブラウザー入口を所有し、Honoのdocument rendererがpageのSSR本文だけを対応containerへ差し込む。Vite+も同じpageを入力にするため、静的配信とBun配信の画面ソースを分けない。

相対moduleの補助宣言はSSRの`render()`内へ置く。ブラウザー専用importは、SSRで実行する式から到達しない場合だけ生成物から除外する。Motion pageにはHonoの`transformSource`から既存Motion変換を適用する。
