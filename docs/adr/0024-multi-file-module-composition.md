# ADR-0024: 相対moduleの静的リンクによる複数ファイル合成

## ステータス

決定済み・実装済み(2026-09-05)

## コンテキスト

`compile(source)`は一つの文字列を受け取り、Program直下の関数宣言だけを処理する。
同一ファイル内のcomponent合成はADR-0014で実装済みだが、別ファイルのcomponentや
helperを通常のimportで使えない。examplesのVite pluginも一つのファイルを直接読む
構造であり、ファイル分割したauthoringの入口にならない。

複数ファイル対応では、module解決、binding衝突、依存順、build-time discoveryの
実行単位、未対応importの扱いを決める必要がある。各fileを個別に`new Function()`で
実行すると、moduleごとのsignal discoveryと副作用順序を別の状態として扱う必要が
生じる。単純な文字列結合では、ES moduleの別々の字句scopeと同名bindingを壊す。

## 決定

1. 既存の`compile(source)`を変更せず、Node側の`compileProject(entryPath)`を追加する。
2. `compileProject`は相対`./`/`../`の静的named/default importだけを、`.js`/`.jsx`
   の依存順へリンクする。module graphの循環は検出して拒否する。
3. moduleごとのトップレベルbindingを衛生的な名前へASTで変更してから一つのprogramへ
   まとめる。component判定は`render(<JSX>)`を持つfunctionに限定し、既存の
   compile-time AST inlineを再利用する。
4. componentでないトップレベルfunctionと単純な`const`は、補助宣言として生成
   moduleのmodule scopeへ出す。同じ宣言をbuild-time executionにも一度だけ渡す。
5. 各moduleを個別に実行せず、リンク済みprogramを一回のbuild-time executionで処理する。
   module直下のsignal/derived/collectionと副作用式は受理しない。
6. 外部specifier、dynamic/namespace/side-effect import、re-export、未解決path、
   循環依存、未対応のmodule文は`compile:`で明示的に拒否する。node_modules、package
   export、dynamic import、cycle semanticsは対象外とする。
7. Vite pluginは入口pathを`compileProject`へ渡す。module graphの読込をplugin側で
   行わない。

## 検討した代替案

- **各fileを個別にbuild-time実行する**: registry、component参照、初期HTMLを統合する
  機構が別に必要になり、import順の副作用を黙って意味論へ持ち込むため却下した。
- **全sourceの文字列結合**: 同名bindingが衝突し、import alias、export、JSX tagの
  bindingも壊れるため却下した。ASTでbindingを変更してからリンクする。
- **生成コードにcomponent runtimeを残す**: component境界をbuild後に消すCONCEPT.v3と
  ADR-0014に反するため却下した。
- **node_modulesとpackage exportを最初から解決する**: このgoalの実需は小規模な
  相対module分割であり、package条件・公開形式・依存最適化を同時に決める必要は
  ないため対象外にした。

## 結果

`compileProject`は別fileのcomponent、helper、constを一つの既存compile pipelineへ
渡せる。生成moduleはruntime component機構を持たず、helperは通常のmodule scopeに
残る。単一file APIとその既存出力は維持される。
