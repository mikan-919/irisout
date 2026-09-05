## compiler

- [x] module graph、相対解決、export/import検証、循環依存検出を実装する。
- [x] module束縛の衛生的な名前付けとリンク済みsourceを実装する。
- [x] `compileProject(entryPath)`と共通compile pipelineの補助宣言境界を実装する。
- [x] 補助関数呼び出しを明示的に許可し、未対応module文をcompile errorにする。

## fixture and tests

- [x] App、component、helper/constantを別moduleに分けたfixtureを追加する。
- [x] 複数段import、props、local signal、条件分岐、List、handlerを実DOMで確認する。
- [x] 初期HTML、mount/hydrate、イベント後DOM、出力のcomponent/runtime面を確認する。
- [x] unsupported import、dynamic import、cycle、未解決pathの拒否を確認する。

## integration and documentation

- [x] examplesのVite pluginをcompileProject経路へ変更する。
- [x] ADR、正本spec、STATUS、ROADMAP、README、architectureを更新する。
- [x] `vp check`、`vp test --run`、`vp build`、OpenSpec validationを実行する。
