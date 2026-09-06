# コーディング規約

## ツールチェーン

- 統合ツールチェーンは **Vite+**。依存導入は`bun install`、静的検査は`vp check`、
  テストは`vp test --run`、example buildは`vp build`を使う。
- package managerはBunに固定するが、直接の`bun test`/`Bun.build`には依存しない。
- フォーマットはOxfmt、lintはOxlint、テストはVite+ Test(Vitest)。設定はルートの
  `vite.config.ts`へ集約する。コミット前は`vp check && vp test --run`。
- `legacy/`と生成済み`dist/`はすべてのチェック対象外。触らない。

## コメント

- **日本語で書く**(コミットメッセージは英語命令形)。
- ファイル冒頭に「このモジュールが何をするか + 現在のスコープ」を書く。
- 設計判断に由来するコードには ADR 番号を添える(例: `// ADR-0006: ...`)。
- 「何をするか」ではなく「なぜそうなっているか・何がスコープ外か」を書く。

## エラーとスコープ制限

未対応の構文は**黙って握りつぶさず、必ず compile error にする**。書式:

```ts
throw new Error('compile: <何が> is not supported yet (scope limit)')
```

- メッセージは `compile:` で始め、意図的な未実装なら末尾に `(scope limit)`。
- 「黙って落とすとバグの温床になる」ものほど早く throw する
  (例: ハンドラ引数を無視せず error にする)。
- スコープを広げるときは対応するマイルストーン(STATUS.md)・plan と揃える。

## 型

- ID はブランド型(`DeclId`, `MarkerId` — `state.ts`)。文字列のまま
  引き回さず、境界で `toDeclId()`/`toMarkerId()` を通す。
- Babel AST の `start`/`end` など解析済みノードで非 null が保証される値には
  non-null assertion(`!`)を使ってよい。
- `any` は本体コードでは使わない(`packages/compiler/test/`のみ許可)。

## コンパイラ実装のパターン

- 共有状態は `CompilerState`(ctx)1個に集約し、各モジュールは ctx を
  受け取って読み書きする。モジュールレベルの可変状態を作らない。
- codegen(`packages/compiler/src/codegen.ts`)は文字列組み立てのみ。AST・ctx を触らせない。
- ソース変換は通常 **Edit リスト方式**(`analyze.ts`)を使う。元ソースの
  `start`/`end`範囲を置換するエディットを集めて一括適用するため、未変更ASTの
  書式を保てる。ネストした置換は1つの大きなeditにせず、外側を分割して内側は
  同じtraverseパスに解決させる。
- 同一ファイルコンポーネントのprops置換、識別子変更、ASTノードの合成を含む
  式は、元ソース上に対応する位置範囲がない場合がある。該当する式全体は
  `packages/compiler/src/compiler/ast-codegen.ts`のASTコード生成へ切り替え、
  `start`/`end`から文字列を切り出さない。ビルド時実行用の
  `sourceRendered`と本番出力用の`rendered`をそれぞれ生成し、変換されていない
  式では従来のEdit方式を使う。この混在が、位置編集の書式保持とAST変換の
  正しさの境界である。

## テスト

- `packages/compiler/test/*.test.ts`を`vp test --run`で実行する。
- DOM は手作りフェイクではなく **jsdom の実 DOM** を使う
  (`packages/compiler/test/helpers.ts` の `createContainer()`)。
- 生成コードの検証は `loadGenerated(code)` で実際に import して実行する —
  文字列マッチだけで済ませない(スナップショット的な文字列比較は
  handwritten fixture との突き合わせ等、出力形そのものが仕様の場合のみ)。
- 新しい scope limit を足したら、その error を踏むテストも足す。

## ドキュメント

役割分担は `CLAUDE.md` 参照。原則:

- ステータスの変化(マイルストーン完了・制約発見)→ `STATUS.md` を即時更新。
- 設計判断(採用も却下も)→ `docs/adr/` に残す。
- 受入条件・仕様の変更→ `openspec/specs/` と対応する
  `openspec/changes/` を揃える。完了したchangeはarchiveへ移す。
- 相対日付を書かない(「先週」ではなく `2026-07-05`)。
