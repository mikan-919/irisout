# tasks — adr-0009-handler-statements

## 1. 解析層(src/compiler/analyze.ts)

- [x] 1.1 `analyzeHandlerBody`(文配列版)を追加する。既存 `visit`
      (読み取り書き換え・`signal(x)` → `signal = x`・`writeDeclIds` 収集)を
      再利用し、文列の範囲(最初の文の start〜最後の文の end)へ edit を適用
      する(design D5)。単一式の従来経路は変えない。
- [x] 1.2 文種検証を実装する: 4文種(式文 / `const`・`let` / `if` / 裸の
      `return`)以外・`var`・`return <expr>` を
      `compile: ... (scope limit)` で拒否。`IfStatement` の consequent /
      alternate は再帰検証(design D2)。
- [x] 1.3 「ソース順で追跡書き込みより後ろの `return`」の拒否を実装する
      (design D3)。分岐内の `return` も対象。

## 2. 受理層(src/compiler/render.ts)

- [x] 2.1 `resolveHandlerBody` を「第1引数名 + 本体(単一式 or 文配列)」を
      返す形へ広げる(design D1)。単純識別子の第1引数を受理し、分割代入
      仮引数・第2引数以降は scope limit のまま拒否。
- [x] 2.2 inline arrow のブロック本体・識別子参照 function 宣言の複数文本体を
      文配列として 1.x の解析へ渡す。単一式は従来経路(golden 差分ゼロを確認)。

## 3. codegen(src/codegen.ts)

- [x] 3.1 ハンドララッパーに第1引数名を束縛する: 引数ありは
      `(<authored名>, ...__args)`、引数なしは従来どおり `(...__args)`
      (design D4)。ブロック本体の文列をラッパー内へ展開する。

## 4. テスト(test/)

- [x] 4.1 受理系: ADR-0008 決定例(`function handleCountUp() { state(state() + 1) }`)、
      4文種すべてを含む本体(`handleInputKeyDown` 相当)、inline arrow の
      ブロック本体。`loadGenerated` で実行し、イベント dispatch で表示更新
      まで検証する(文字列マッチだけにしない)。
- [x] 4.2 イベント引数系: `e` の受け渡し(実イベントオブジェクトが届く)、
      引数名が signal 名をシャドーするケース、ローカル `const` の
      シャドーケース。
- [x] 4.3 変換系: 文中の `todos([...todos(), item])` が代入になり呼び出し形が
      残らないこと、分岐内書き込みでも末尾に `update_*()` が出ること
      (静的過剰近似)。
- [x] 4.4 拒否系(新 scope limit を全部踏む): ループ / `var` /
      `return <expr>` / 書き込み後の `return` / 分割代入仮引数。
- [x] 4.5 golden スナップショット: 既存フィクスチャの出力が不変であることを
      確認し、ブロック本体ハンドラの golden を1本追加する。

## 5. ドキュメント・仕上げ

- [x] 5.1 `docs/adr/0009-handler-statements-and-event-object.md` のステータスを
      「承認済み」へ更新する(推奨案1〜5を採用、design D2/D3 の追加決定へ
      言及)。
- [x] 5.2 `STATUS.md` の既知の制約(ハンドラ本体は単一式のみ)を解消として
      更新し、新しい制約(4文種限定・書き込み後 return 拒否)を記す。
      `ROADMAP.md` の UNRESOLVED(09) に受け渡し解決済み・型付けは未決のまま
      と反映する。
- [x] 5.3 `bun run check-all` を通し、動作確認済みの状態でコミットする。
