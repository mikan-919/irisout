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

エントリは `src/compiler.ts` の `compile(source)`。処理は6段:

```
source (.jsx)
  │ 1. @babel/parser で parse(静的 AST)
  ▼
inlineComponents()            ── 2. 同一ファイル内<Component/>参照をコンパイル時ASTインライン化
  │    (src/compiler/inline-components.ts、ADR-0014)。findRootComponent()より前に完結する
  │    独立した前処理パスで、以後のパイプラインはコンポーネント合成という概念を一切知らない。
  ▼
findRootComponent()          ── 3. 誰からも参照されない唯一のトップレベル関数をルートとする
  ▼
compileComponent()           ── 4. render ツリーを深さ優先で走査(src/compiler/render.ts)
  │    ・signal()/derived() 宣言 → declId 発行 + 出力文生成
  │    ・JSX 式 → マーカー発行 + 依存(deps)収集(src/compiler/analyze.ts)
  │    ・onXxx ハンドラ → 書き込み先 signal(writeDeclIds)収集
  ▼
new Function() でビルド時実行 ── 5. 計装済みスクリプトを Node 上で1回実行し、
  │    (a) タグ付けした呼び出しが本当に signal/derived か検証(ADR-0001 #3)
  │    (b) 実際の初期 HTML をタダで取得
  ▼
generateModule()             ── 6. 依存グラフから ES モジュールを文字列組み立て(src/codegen.ts)
  │    ・宣言はプレーン変数(ADR-0006: signal ラッパーは出力に残らない)
  │    ・root signal ごとに専用 update_<name>() を生成
  ▼
{ code, initialHtml, ... }
```

`compileComponent()`(4)が受理しないパターンに当たると、常に
`compile:`+`(scope limit)`エラーで拒否する(ADR-0004の裏面、
「安全に拒否する」)。この拒否からの公式な逃げ道は`use=`アクション
(ADR-0011、設計決定済み・未実装): 実要素にactionを接続し、本体から
コンパイル管理外のグローバル関数へ委譲する。専用のエスケープハッチ
要素(`<Escape mount>`、ADR-0010)は棚上げした(ADR-0010
「棚上げの経緯」参照)。scope limitへの苦情はADR-0011決定7の
triage手続きで捌く — コンパイラの受理条件自体を場当たりに緩めない。

## モジュールの責務

| ファイル | 責務 |
|---|---|
| `src/compiler.ts` | パイプライン全体の統括。ルート特定、ビルド時実行、discovery 検証 |
| `src/compiler/inline-components.ts` | 同一ファイル内`<Component/>`参照のコンパイル時ASTインライン化(ADR-0014)。findRootComponent()より前に完結する独立した前処理パス |
| `src/compiler/state.ts` | `compile()` 全体で共有するミュータブル状態 `CompilerState`(ctx)と ID 型 |
| `src/compiler/render.ts` | JSX ツリーの走査。宣言・マーカー・ハンドラを ctx に積み、HTML テンプレートソースを組み立てる |
| `src/compiler/analyze.ts` | 式の解析。識別子を declId に解決し、出力用/ビルド時実行用の2種類のソースを生成 |
| `src/compiler/decl-graph.ts` | derived を辿ってルート signal 集合へ展開する推移解決 |
| `src/codegen.ts` | 最終 codegen。文字列組み立てのみ、AST もコンパイラ状態も触らない |
| `src/runtime.ts` | 2つの顔を持つ: signal/derived は**ビルド時専用**(discovery 用、出力に import されない)、mount/hydrate は**ブラウザ出荷用** DOM グルー |
| `src/template.ts` | テンプレートリテラル組み立てヘルパー(render と codegen の共有部) |
| `scripts/build.ts` | .jsx → `dist/index.html`(焼き込み済み HTML)+ `dist/app.js`(hydrate のみ) |

## 重要な概念

- **DeclId / MarkerId**(state.ts): どちらも文字列だがブランド型で取り違えを
  コンパイル時に防ぐ。`decl_<instanceId>_<declaratorStart>` / `m<連番>`。
- **rendered と sourceRendered の二重生成**(analyze.ts): 同じ式から
  (a) 本番出力用 = `count()` を裸の `count` へ書き換えたもの(ADR-0006)と
  (b) ビルド時実行用 = 本物のアクセサ呼び出しを保ったもの、の両方を作る。
  ビルド時実行だけが本物の signal/derived を使う。
- **マーカー**: reactive な箇所に `data-iris-id` を振り、mount/hydrate 時に
  一度だけ収集して以後 DOM を探索しない。テキストの連なり(JSXText+式)は
  1回の textContent 置換で更新するアトミックな単位として1マーカーにまとめる。
- **依存グラフが単一の真実の源**: marker→decl の直接依存(`ctx.markerDeps`)を
  `resolveToSignals()` で root signal まで推移解決し、signal→markers の逆引き
  から `update_<name>()` を生成する。ハンドラの書き込み先も同じ経路で解決。

## 設計変更の進め方

1. 論点が出たら `ROADMAP.md` に積む(ステータス情報は書かない)。
2. 判断が固まったら `docs/adr/NNNN-<slug>.md` を書く。ステータス
   (決定済み/却下)・コンテキスト・決定・検討した代替案を残す。
   却下した案も ADR にする(例: ADR-0007)。
3. 実装単位に切れたら `plans/` に実行可能な計画を書き、`plans/README.md` の
   索引(実行順・依存・ステータス表)に行を足す。完了したら索引を DONE に更新。
4. マイルストーン完了・計画外の制約発見時は `STATUS.md` を更新する。

## legacy/ について

`legacy/` は元の JS 実装。**参照専用でメンテナンスしない**。TypeScript 版の
マイルストーンは legacy から機能を移植しながら進めるので、未実装機能の
挙動・テストの参考として読むのは有用(biome のチェック対象外)。
