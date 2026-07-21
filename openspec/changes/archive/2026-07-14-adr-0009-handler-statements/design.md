# design — adr-0009-handler-statements

## Context

ADR-0009(ドラフト)が設計の本体。5つの設計質問(イベント引数の受け渡し・
最小文種集合・条件分岐内書き込みの意味論・`analyzeHandlerExpr` の拡張形・
ADR-0008 との接続)はスクラッチ実験込みで検証済みなので、ここでは
**ADR が未規定だった実装レベルの決定だけ**を記す。現状:

- `src/compiler/render.ts` `resolveHandlerBody` — inline arrow / 識別子参照
  function 宣言の両形を「引数ゼロ・単一式本体」に制限(`render.ts:207-252`)。
- `src/compiler/analyze.ts` `analyzeHandlerExpr` — 単一式を受け、edit ベースの
  `visit` で読み取り(`count()` → `count`)・書き込み(`count(x)` →
  `count = x`)を書き換え、`writeDeclIds` を収集。
- `src/codegen.ts:55` — ラッパーは `(...__args) => { ${rendered}; ${updateCalls} }`
  で既に可変長引数。
- 目標出力は `examples/todomvc.handwritten.js:65-73` — 本体末尾に
  `update_*()`、ガード的早期 return はそれより前(=書き込み前)にある。

## Goals / Non-Goals

**Goals:**

- ハンドラ(inline arrow / 識別子参照 function 宣言の両形)のブロック本体を
  4文種(式文 / `const`・`let` / `if` / `return`)で受理し、文中の
  `signal(x)` → `signal = x` 変換と `writeDeclIds` 収集を効かせる。
- ハンドラの第1仮引数(イベントオブジェクト)を authored 名のまま受け渡す。
- 生成コードの形は handwritten fixture の意味論(本体末尾 update、書き込み前の
  早期 return は update を飛ばしてよい)と一致させる。

**Non-Goals:**

- `e` の静的型付け(ADR-0009 の未決定事項、独立に決める)。
- ループ・`try`/`switch`・分割代入引数・第2引数以降(すべて scope limit 維持)。
- 名前付き function をそのまま出力へ残す codegen(下記 D4 の代案。golden の
  形が変わるため今回は見送り)。

## Decisions

### D1: `resolveHandlerBody` は「本体の文配列 + 第1引数名」を返す形へ広げる

戻り値を単一式 path から
`{ param: string | null, body: 単一式 path | 文配列 }` 相当へ変更する。
inline arrow の式本体は従来どおり単一式として扱い(出力形を変えない=
golden 維持)、ブロック本体・function 宣言本体は文配列として返す。
両形が同じ検証・解析を通る(ADR-0009 質問5)。

### D2: 文種検証は if の枝へ再帰する

本体直下の各文を4文種で検証し、`IfStatement` の consequent / alternate は
「4文種のいずれか、または4文種のみからなる `BlockStatement`」として再帰的に
検証する(`if (x) return` のような裸の文も、`{ ... }` ブロックも許す)。
4文種の外に加えて次も明示拒否する:

- `var` 宣言(巻き上げ意味論が未検証。`const`/`let` のみ)
- 値を返す `return <expr>`(イベントリスナの戻り値は無意味。裸の `return` のみ)

### D3: 書き込みより後(ソース順)の `return` は scope limit で拒否する

現行 codegen は `update_*()` をラッパー本体の**末尾**に置くため、書き込み後に
早期 return が来る本体は更新漏れ(書いたのに再描画しない)になる。規約
「黙って握りつぶさず compile error」に従い、**ソース順で最初の追跡書き込み
より後ろに `return` がある本体は拒否**する。TodoMVC のパターン(ガード
return がすべて書き込みより前)は通る。

- 代案 (a) `try/finally` で update を保証 — 出力が膨らむ(ADR-0004)うえ
  handwritten の形から離れる。却下。
- 代案 (b) 該当 `return` の直前へ update 呼び出しを挿入 — 実需(TodoMVC)に
  ない先取り。必要になったらこの形へ拡張する(upgrade path)。

### D4: codegen はラッパー形を維持し、引数名と文列を差し込む

`const __handler_<marker>_<event> = (...__args) => { <body>; <updates> }` の
形を保つ。第1引数があるハンドラのみ `(...__args)` を `(<authored名>, ...__args)`
へ変える(引数なしハンドラの出力は不変= golden 差分ゼロ)。ブロック本体は
文をそのままラッパー内へ展開する。early return はラッパー内で完結し、D3 に
より「return 後に update が要る本体」は存在しない。

- 代案: 識別子参照ハンドラは authored の名前付き function を出力へ残し
  `addEventListener('keydown', handleInputKeyDown)` と handwritten そのままの
  形で配線する — 見た目は理想だが update 挿入位置・重複参照の扱いが増え、
  golden 全面更新になる。意味論は D4 と同一なので今回は見送り
  (将来の美観改善として ROADMAP 行きも不要、実害がない)。

### D5: 解析の入力粒度だけを式→文へ上げる(ADR-0009 質問4 そのまま)

`analyzeHandlerExpr` の `visit`(読み取り書き換え・書き込み代入化・
`writeDeclIds` 収集)を変更せず、走査対象を文配列へ広げた
`analyzeHandlerBody` を用意する(単一式は従来経路のまま)。`render()` の
edit 適用は `[start, end)` 区間汎用なので、文列の範囲(最初の文の start〜
最後の文の end)にそのまま使える。条件分岐内の書き込みは traverse が制御
フローを解釈しないことで自然に静的過剰近似になる(質問3、スクラッチ検証3)。

### D6: ADR-0009 をこの change で「承認済み」へ更新する

推奨案(質問1〜5)をそのまま採用する。実装マージ時に ADR のステータスを
更新し、STATUS.md の「単一式のみ」制約・ROADMAP の UNRESOLVED(09) を反映する。

## Risks / Trade-offs

- [静的過剰近似] 到達しない分岐の書き込みでも `update_*()` が出る →
  no-op に倒れる安全側の誤りとして受容(ADR-0009 質問3)。
- [D3 の拒否が厳しすぎる可能性] 「書き込み→早期 return→続き」を書きたい
  実需が出うる → scope limit のエラーメッセージで意図を伝え、必要時に
  D3 代案(b)(return 直前への update 挿入)へ拡張。
- [同一 function を複数要素から参照すると本体が要素ごとに複製される] →
  現行ラッパー設計の延長で、実害(サイズ)が出るまで放置。D4 代案が
  解決策になる。
- [ビルド時実行との整合] ハンドラ本体は discovery で実行されない(イベントが
  発火しない)ため、文レベル化による build-time 実行への影響はない。
  テストで `loadGenerated` による実行検証を必ず行い確認する。
