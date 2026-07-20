# Design: cross-function-handler-writes

## Context

ADR-0013 で決定済み: ハンドラ/action 本体内の動きゾーン関数呼び出しを
binding 確認つきで追跡する。現状の構造(前提):

- `resolveHandlerBody`(`src/compiler/render.ts`)が inline arrow と
  識別子参照を同じ `HandlerBody` に正規化済み。解析経路は1本。
- ハンドラ本体の解析(`src/compiler/analyze.ts`)は参照識別子を
  `resolveDeclId` で declId に解決するが、binding が
  `VariableDeclarator` 以外(function 宣言・仮引数・グローバル)は
  null → 素通しする。呼び出し式もこの経路で黙って素通りするのが本バグ。
- 動きゾーンの function 宣言は `handlerFns`(名前 → NodePath)として
  render 側で収集済み。出力には関数として存在しない(識別子参照ハンドラ
  でもマーカーごとの `__handler_*` にインライン展開)。

## Goals / Non-Goals

**Goals:**

- ハンドラ本体・action 本体(ブロック/concise・返り値クロージャ含む)内の
  動きゾーン関数呼び出しの追跡・emit・拒否(ADR-0013 決定 1〜4)。
- 既存テスト面(no-wrapper・import 面)の不変。

**Non-Goals:**

- 識別子参照ハンドラのインライン展開の変更(`onClick={toggle}` は従来
  どおりマーカーごとに展開する。同じ関数が「ハンドラ参照」と「呼び出し
  先」の両方で使われた場合の本体重複は許容 — 統一は実需が出てから)。
- 動きゾーン関数どうしの引数以外のデータ受け渡し・返り値の追跡対象化。
- ユニット内 `use=` など既存の別 scope limit の緩和。

## Decisions

### D1: 検出は共有 visitor の CallExpression 分岐で行う

ハンドラ/action の各解析関数が共有する識別子 visit の手前に「呼び出し式の
callee 識別子」の分岐を足す。判定は `scope.getBinding`:

- binding なし(グローバル)→ 素通し(従来どおり)。
- binding の解決先が `handlerFns` にある function 宣言と同一ノード →
  追跡対象。呼び出し式自体は書き換えず、callee 名もそのまま出力する。
- それ以外(仮引数・ローカル宣言・変数ゾーン由来)→ `scope limit`。
  エラー書式は既存規約(`compile: ... (scope limit)`)に従う。

### D2: 呼び出し先の解析は既存のハンドラ本体解析を再利用し、compile 単位でメモ化する

呼び出し先本体には `analyzeActionStatements` 系(4文種制限・読み取り
書き換え・書き込み代入化・rendered/sourceRendered の二重生成)を
そのまま適用する。新しい解析器は書かない。関数ごとに1回だけ解析して
`CompilerState` に記録(名前・書き換え済み本体・推移的 writeDeclIds)し、
複数ハンドラから呼ばれても再解析しない。循環(自己・相互再帰)は
in-progress マーカーで打ち切り、writeDeclIds は共有 Set への合流で
収束させる。

### D3: `update_*()` は呼び出し元ハンドラ末尾のみ、emit 本体には入れない

emit する関数本体に `update_*()` は挿入しない。呼び出し元ハンドラが
callee の推移的 writeDeclIds を自分の writeDeclIds に合流し、従来どおり
本体末尾で一括更新する。「書き込みが全部終わってから更新」の現行
セマンティクスを維持し、多重呼び出しでも update が重複実行されない。

追跡対象呼び出しは ADR-0009 D3(追跡書き込みより後ろの `return` 拒否)の
「追跡書き込み」として数える — 呼び出しの後ろの `return` は同様に拒否する
(末尾 update の取りこぼし防止)。

### D4: emit は authored 名のままモジュールスコープへ1回だけ

codegen は記録された関数を `function <authoredName>(...) { <書き換え済み
本体> }` として出力先頭部(宣言群の後)に emit する。名前は authored の
まま(トップレベル関数名はソース内で一意)。生成側の予約名
(`update_<signal>` / `__` 接頭辞)と衝突する authored 名は compile error
で拒否する(黙ってリネームしない)。

## Risks / Trade-offs

- [誤検知: 追跡と無関係なローカル関数呼び出しまで拒否(D1 第3分岐)]
  → 動きゾーンに移すか本体へ直接書く逃げ道が常にある。黙って落とすより
  正直(ADR-0004)。
- [ハンドラ参照と呼び出し先の二重展開で出力が増える(Non-Goal)]
  → 実害が出た事例がない。出たら「識別子参照ハンドラも emit 関数を
  参照する」統一 change を別途起票。
- [ビルド時実行スクリプトへの影響] → ハンドラ本体は既存でもビルド時
  実行の対象ではなく、sourceRendered の扱いは D2 の再利用でそのまま
  引き継ぐ。新規の実行面は増えない。
