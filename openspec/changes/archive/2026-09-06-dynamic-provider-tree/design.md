## 設計

`renderStructuralUnitBody()`がunit開始時に親のcontext値を複製し、unit直下のprovider式を
現在のvalue mapへ設定する。`useContext()`はその時点のvalueへAST/文字列置換される。
provider値の依存は置換後の式としてmarker依存へ合流するため、root/local signalの更新は
既存factory updateを通る。branch切替は既存conditional lifecycleが旧factoryを破棄して
新しいmapを持つfactoryを生成する。

動的provider treeはこのcompile-time treeに限定し、runtimeのprovider登録機構は追加しない。
