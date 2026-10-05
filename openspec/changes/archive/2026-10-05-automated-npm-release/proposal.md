# タグからのnpm公開

毎回の版更新、検証、npm認証、GitHubリリース作成を自動化する。Bunで版更新と照合を行い、タグpushから既存CIとnpmのOIDC公開、公開版の導入検査、変更履歴の公開を実行する。手動実行は公開を伴わない予行とする。

受入条件は`openspec/specs/single-package-distribution/spec.md`に反映する。npmの公開元登録には初回の二要素認証が必要である。
