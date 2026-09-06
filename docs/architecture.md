# irisout アーキテクチャ

コンパイラの内部構造と設計の進め方。**何を作るか・なぜか**は `CONCEPT.v3.md`、
**個別の設計判断**は `docs/adr/`、**現在の実装範囲**は `STATUS.md` を参照。

## 統治原則

すべての設計判断は ADR-0004 の原則に照らして行う:

> コンパイラは、生成するコードがソースの意味的要求を超えて何かを実行しない限り、
> 変換・最適化を自由に行ってよい。

- ソースが要求する仕事の範囲内なら、専用コードへの展開と小さな共有ヘルパーの
  どちらも選べる。速度・サイズ・メモリと実装の単純さを実測して決める。
- ソースが要求していないライフサイクル機構・汎用ディスパッチ・隠れた互換性
  コストは、将来のためでも追加しない。
- 迷ったら「この UI に必要な仕事だけを、ブラウザで最も小さく素直に実行する
  にはどう書くか」(`CONCEPT.v3.md`)に立ち返る。

## コンパイルパイプライン

入口は `packages/compiler/src/compiler.ts` の `compile(source)` または
`compileProject(entryPath)`である。`compile(source)`は単一sourceをそのまま6段で処理する。
`compileProject(entryPath)`は最初に`module-linker.ts`で相対moduleを検査・解決・ASTリンクし、
リンク済みsourceを同じ6段へ渡す。module-linkerは各fileを実行せず、build-time executionの
単位を一つに保つ。

```
source (.jsx)
  │ 1. @babel/parser で parse(静的 AST)
  ▼
inlineComponents()            ── 2. 同一ファイル内<Component/>参照をコンパイル時ASTインライン化
  │    (packages/compiler/src/compiler/inline-components.ts、ADR-0014)。findRootComponent()より前に完結する
  │    独立した前処理パスで、以後のパイプラインはコンポーネント合成という概念を一切知らない。
  ▼
findRootComponent()          ── 3. 誰からも参照されない唯一のトップレベル関数をルートとする
  ▼
compileComponent()           ── 4. render ツリーを深さ優先で走査(packages/compiler/src/compiler/render.ts)
  │    ・signal()/derived() 宣言 → declId 発行 + 出力文生成
  │    ・JSX 式 → マーカー発行 + 依存(deps)収集(packages/compiler/src/compiler/analyze.ts)
  │    ・AST変換済みの式 → ASTコード生成、未変更の式 → 位置編集
  │    ・onXxx ハンドラ → 書き込み先 signal(writeDeclIds)収集
  ▼
new Function() でビルド時実行 ── 5. 計装済みスクリプトを Node 上で1回実行し、
  │    (a) タグ付けした呼び出しが本当に signal/derived か検証(ADR-0001 #3)
  │    (b) 実際の初期 HTML をタダで取得
  ▼
generateModule()             ── 6. 依存グラフから ES モジュールを文字列組み立て(packages/compiler/src/codegen.ts)
  │    ・宣言はプレーン変数(ADR-0006: signal ラッパーは出力に残らない)
  │    ・root signal ごとに専用 update_<name>() を生成
  │    ・共有markerを持つ複数root writeにだけ同期batchを生成(ADR-0020)
  ▼
{ code, initialHtml, ... }
```

`compileProject(entryPath)`の追加段は次の通りである。

```
entryPath (.js/.jsx)
  │ module-linker: 相対import解決、依存順、cycle/import/export検証、binding名変更、依存path収集
  ▼
linked source + module-scope補助宣言
  │
  └── 上のparseからgenerateModuleまでの処理
```

`compileProject()`は生成結果とともに、リンクした入口・相対moduleの絶対pathを返す。
`@irisout/vite-plugin`はこの一覧だけを監視対象にし、変更時に同じ入口を再コンパイルする。
初期HTMLはindex.htmlのmarkerへ埋め込み、仮想moduleへhydrate処理を出力する。開発時の
変更反映はページ全体の再読み込みであり、状態保持やDOM差分HMRは対象外である。

`compileComponent()`(4)が受理しないパターンに当たると、常に
`compile:`+`(scope limit)`エラーで拒否する(ADR-0004の裏面、
「安全に拒否する」)。この拒否からの公式な逃げ道は`use=`アクション
(ADR-0011/0022、top-level要素と構造unit内の実要素で実装済み): 実要素にactionを接続し、本体から
コンパイル管理外のグローバル関数へ委譲する。専用のエスケープハッチ
要素(`<Escape mount>`、ADR-0010)は棚上げした(ADR-0010
「棚上げの経緯」参照)。scope limitへの苦情はADR-0011決定7の
triage手続きで捌く — コンパイラの受理条件自体を場当たりに緩めない。

## モジュールの責務

| ファイル                                              | 責務                                                                                                                                                                                                |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/compiler/src/compiler.ts`                   | パイプライン全体の統括。ルート特定、ビルド時実行、discovery 検証                                                                                                                                    |
| `packages/compiler/src/compiler/module-linker.ts`     | `compileProject()`の相対`.js`/`.jsx`解決、依存順、静的import/export検証、cycle検出、AST binding名変更、補助宣言抽出                                                                                 |
| `packages/compiler/src/compiler/inline-components.ts` | 同一ファイル内`<Component/>`参照のコンパイル時ASTインライン化(ADR-0014)。findRootComponent()より前に完結する独立した前処理パス                                                                      |
| `packages/compiler/src/compiler/state.ts`             | `compile()` 全体で共有するミュータブル状態 `CompilerState`(ctx)と ID 型                                                                                                                             |
| `packages/compiler/src/compiler/render.ts`            | JSX ツリーの走査。宣言・マーカー・ハンドラを ctx に積み、HTML テンプレートソースを組み立てる                                                                                                        |
| `packages/compiler/src/compiler/analyze.ts`           | 式の解析。識別子を declId に解決し、出力用/ビルド時実行用の2種類のソースを生成                                                                                                                      |
| `packages/compiler/src/compiler/ast-codegen.ts`       | props置換などAST変換を含む式を、元ソースの位置範囲に依存せずASTからコード生成する境界                                                                                                               |
| `packages/compiler/src/compiler/decl-graph.ts`        | derived を辿ってルート signal 集合へ展開する推移解決                                                                                                                                                |
| `packages/compiler/src/codegen.ts`                    | 最終 codegen。文字列組み立てのみ、AST もコンパイラ状態も触らない                                                                                                                                    |
| `packages/vite-plugin/src/index.ts`                   | `compileProject()`の生成結果をViteの仮想module・初期HTML・依存監視・全体再読み込みへ接続                                                                                                            |
| `packages/runtime/src/index.ts`                       | 2つの顔を持つ: signal/derived は**ビルド時専用**。mount/hydrate、`use=`返り値のshape検証、List使用時だけimportされるkey照合・binding値キャッシュは**ブラウザ出荷用**の最小ランタイム(ADR-0015/0022) |
| `packages/compiler/src/template.ts`                   | テンプレートリテラル組み立てヘルパー(render と codegen の共有部)                                                                                                                                    |
| `apps/examples/vite.config.ts`                        | `@irisout/vite-plugin`へentry pathを渡し、`dist/index.html`(焼き込み済み HTML)+ `dist/app.js`(hydrate のみ)を生成                                                                                   |

## 重要な概念

- **DeclId / MarkerId**(state.ts): どちらも文字列だがブランド型で取り違えを
  コンパイル時に防ぐ。`decl_<instanceId>_<declaratorStart>` / `m<連番>`。
- **rendered と sourceRendered の二重生成**(analyze.ts): 同じ式から
  (a) 本番出力用 = `count()` を裸の `count` へ書き換えたもの(ADR-0006)と
  (b) ビルド時実行用 = 本物のアクセサ呼び出しを保ったもの、の両方を作る。
  ビルド時実行だけが本物の signal/derived を使う。
- **ソース文字列とASTコード生成の境界**: 元のASTを変更していない式は
  `start`/`end`に基づくEditリストで出力し、元ソースの書式を保つ。props置換や
  識別子変更を含む式は、置換されたノードを含む式全体を
  `ast-codegen.ts`でASTから出力する。置換先のノードが呼び出し元ソースの位置を
  持つ場合や、値なし属性から合成した`true`のように位置を持たない場合でも、
  呼び出し先の古い文字列を切り出さない。この処理はpropsを実行時オブジェクトへ
  変換するものではなく、コンパイル時に消える識別子置換である。
- **マーカー**: reactive な箇所に `data-iris-id` を振り、mount/hydrate 時に
  一度だけ収集して以後 DOM を探索しない。テキストの連なり(JSXText+式)は
  1回の textContent 置換で更新するアトミックな単位として1マーカーにまとめる。
- **component lifecycle**(ADR-0022): `createComponent()` factoryは
  `mount`/`hydrate`/`unmount`とinstance専用updateを返す。mountまたはhydrateは
  instanceにつき1回、unmountはidempotent。unmount時にtop-level handlerを同一identity
  でremoveし、action `destroy`を逆順に実行してからcomponent-owned DOM、marker Map、
  List/conditional/template stateを解放する。unmount後のupdateはno-opで、同instanceの
  再mountは拒否する。
- **root `onMount` lifecycle**(ADR-0025): 動きゾーンの0引数callbackをmarker収集・
  handler配線・構造unit初期化・`use=` action初期化の後に一度実行する。callbackが返す
  0引数cleanupはinstanceが保持し、unmount時に登録順の逆順で一度だけ実行する。
  初期化失敗時は登録済みcleanupを回収し、構造unit/actionと同じ例外回収規則を使う。
  構造unit内の`onMount`はunit factoryが所有し、inline化された子componentのcallbackは
  rootまたは現在のunitへ静的に収集する。runtime child objectは生成しない。
- **root `effect` lifecycle**(ADR-0026): 動きゾーンの0引数callbackが直接読むroot
  signal/derivedを専用`update_*()`へ接続し、初回実行・依存更新前のcleanup・unmountの
  cleanupを生成instanceが所有する。構造unit・inline子componentのeffectはunit/root
  instanceの専用updateへ接続する。汎用schedulerは導入せず、effect本体から追跡signalへの
  書き込みと非同期schedulerはscope limitで拒否する。
- **instance context**(ADR-0027〜0029): トップレベル`createContext(defaultValue)`をcompile-timeの
  keyとして収集し、`provideContext(key, value)`を現在のrootまたはstructural factoryへ
  登録する。`useContext(key)`は最も近いprovider/defaultの式へ置換し、値式のsignal依存を
  既存marker/update経路へ合流させる。runtimeのMap・provider registryは生成せず、未使用時の
  context専用出力も省略する。構造unitの動的provider treeとPromiseLikeの非同期contextは
  静的置換の範囲で実装済みで、runtime provider伝播・schedulerはscope limitである。
- **`use=` action result**: 既存の `() => void` は `update` closureとして初回+依存
  signal update時に呼ぶ。外部resource cleanupが必要な場合だけ
  `{ update?: () => void; destroy?: () => void }`を返し、`destroy`はunmount時のみ呼ぶ。
  構造unit内ではitem/branch factoryのinstanceがactionを所有し、keyの再利用では
  初期化・破棄を繰り返さない。runtime境界でshapeを検証し、汎用lifecycle schedulerは
  導入しない。
- **依存グラフが単一の真実の源**: marker→decl の直接依存(`ctx.markerDeps`)を
  `resolveToSignals()` で root signal まで推移解決し、signal→markers の逆引き
  から `update_<name>()` を生成する。ハンドラの書き込み先も同じ経路で解決する。
  複数rootのwrite setにmarker集合の交差がある場合だけ、その和集合を一度ずつ
  更新するinstance内同期batchを生成する(ADR-0020)。microtask schedulerや
  汎用subscription graphは持たない。
- **List更新アドレス**(ADR-0015): コンパイル時のList marker ID、key式のitem ID、
  item内marker由来のbinding IDを分離して保持する。共有ランタイムはkey照合と
  DOM順序、生成factoryはbinding単位の直接DOM更新を担当する。
- **module境界**(ADR-0024/0030): `compileProject()`は相対`.js`/`.jsx`の静的named/default
  importだけをAST bindingへ解決する。componentはinline pathへ入り、通常のfunctionと
  `const`だけが補助宣言としてmodule scopeに残る。直接`const name = signal(initial)`と
  `const name = derived(() => expression)`は、参照時だけ専用shared stateとして出力する。
  外部module、dynamic import、re-export、cycle、`collection`を含むその他のmodule scope
  stateは`compile:`エラーで拒否する。shared signalはinstance更新を購読し、shared derivedは
  その関数を読む既存の依存経路へ接続する(ADR-0030/0037)。

## 設計変更の進め方

1. 論点が出たら `ROADMAP.md` に積む(ステータス情報は書かない)。
2. 判断が固まったら `docs/adr/NNNN-<slug>.md` を書く。ステータス
   (決定済み/却下)・コンテキスト・決定・検討した代替案を残す。
   却下した案も ADR にする(例: ADR-0007)。
3. 実装単位に切れたら `openspec/changes/<name>/` にproposal/design/tasksを
   書き、受入条件を `openspec/specs/` の正本へ反映する。OpenSpecのCLIを使う
   場合は `bunx @fission-ai/openspec` を使い、完了後はchangeをarchiveする。
4. マイルストーン完了・計画外の制約発見時は `STATUS.md` を更新する。

## legacy/ について

`legacy/` は元の JS 実装。**参照専用でメンテナンスしない**。TypeScript 版の
マイルストーンは legacy から機能を移植しながら進めるので、未実装機能の
挙動・テストの参考として読むのは有用(biome のチェック対象外)。
