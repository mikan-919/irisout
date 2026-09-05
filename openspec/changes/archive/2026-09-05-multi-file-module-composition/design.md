## 設計

### 1. APIと責務

既存の`compile(source: string)`は単一ファイルAPIとして残す。ファイル解決が
必要なNode側の入口として`compileProject(entryPath: string)`をcompiler packageへ
追加する。`compileProject`はmodule graphを作り、リンク済みsourceと生成へ残す
補助宣言を内部の共通compile pipelineへ渡す。Vite pluginはsourceを読む責務を
持たず、入口pathだけを渡す。

### 2. module解決

import sourceは`./`または`../`で始まるものだけを受理する。specifierは
そのままのファイル、`.jsx`、`.js`の順で解決し、未解決ならエラーにする。
対象moduleは`ImportDeclaration`の静的文字列だけを持てる。named importと
default importを受理する。namespace import、side-effect import、dynamic
import、`export *`、re-export、`export default`の式は未対応として拒否する。

moduleのProgram直下ではimport、function declaration、`const` declaration、
それらのexportだけを受理する。トップレベルのsignal/derived/collection、
副作用式、`let`/`var`、分割代入は拒否する。補助関数は通常のfunction declaration、
定数はinitializerを持つ単純な`const`とする。

DFSで依存を収集し、訪問中のmoduleへ戻った時点で循環依存を拒否する。各moduleの
トップレベル束縛にはmodule番号を含む名前を割り当て、ASTのbinding参照とJSXの
コンポーネントタグを同じ名前へ更新する。これにより、moduleごとの字句scopeを
一つのcompile programへリンクしても衝突しない。リンク後にBabelでsourceを
生成し、既存のsource位置編集・AST codegenが使える位置情報を再構築する。

### 3. componentと補助宣言

`render(<JSX>)`を自分の関数本体に持つトップレベルfunctionをcomponentと判定する。
リンク後の全componentを既存の`inlineComponents`へ渡し、entryから参照されない
componentが一つだけrootになる。componentのfunction declarationは出力しない。

componentでないトップレベルfunctionとconst declarationは、依存順の文字列として
生成moduleのmodule scopeへ一度だけ出力する。ビルド時実行にも同じ補助宣言を先に
渡す。補助関数の呼び出しは、movement-zone functionの追跡対象ではなく、関数本体を
再解析しない通常のJavaScript呼び出しとする。したがって、補助関数はcomponentの
signalを暗黙に書き換えない純粋な補助処理に限定し、signal更新はcomponent側の
handler/actionに書く。

### 4. build-time execution

リンク済みmoduleを一つの静的programとして一回だけ`new Function`へ渡す。各fileを
個別に実行しないため、import順序に依存した複数のdiscovery registryや副作用の
実行単位を作らない。moduleのトップレベル副作用は受理しない。signal/derived/
collectionのdiscoveryは従来どおりcomponentの変数zoneだけで行う。

### 5. 出力とruntime

生成ES moduleのimportは`@irisout/runtime`だけにする。component境界やprops objectは
出力しない。補助宣言は通常のmodule scopeへ出し、signal/derivedの値・marker・
handler・構造unitは既存の`createComponent`内に残す。List・conditional・actionを
使わないmoduleへ、それらのruntime helperを追加しない。

### 6. 受入条件

- entryから相対importしたcomponentをJSXで利用でき、2段以上の相対importも解決できる。
- imported helper functionとimmutable constをJSX式、derived、handler、propsで使える。
- component名・`signal(`・`derived(`が生成moduleへ残らない。
- 初期HTML、mount、hydrate、event後のDOMを独立した実DOM試験で確認できる。
- `IRISOUT_ENTRY`でexamplesのVite buildがfixtureを生成できる。
- `vp check`、`vp test --run`、`vp build`とOpenSpec validationが成功する。
