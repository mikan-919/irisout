# 一覧更新で不要な処理を減らす

js-framework-benchmarkの各操作で、全行照合、値比較、配置、複製時の探索の費用を測定して削減する。通常の`signal`とJSXの記述を維持する。受入条件は`list-conditional-rendering`、設計判断はADR-0066に記録する。
