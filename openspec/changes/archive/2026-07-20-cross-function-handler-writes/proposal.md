# Proposal: cross-function-handler-writes

## Why

inline arrow ハンドラから動きゾーンの補助関数を呼ぶと
(`onClick={() => toggle(todo.id)}`)、`toggle` 本体の signal 書き込みが
解析されず `update_*()` が発火しない — 黙って更新が落ちる(M2 以来、
ROADMAP 旧論点 0)。引数を渡したいアイテム内ハンドラで踏みやすく、
「黙って落とさず安全に拒否する」規約(ADR-0004)に反する。ADR-0013 で
「binding 確認つきの呼び出し追跡」を採用済み。本 change はその実装。

## What Changes

- ハンドラ/action 本体内の呼び出し式で、callee が Babel binding 解決で
  動きゾーン(render() より後ろ)の function 宣言と同一物と確認できた
  場合、その本体を再帰的に追跡する(visited-set・深さ制限なし)。
- 呼び出し先本体はハンドラ本体と同じ規則で解析(ADR-0009 の4文種制限・
  読み取り書き換え・書き込み代入化)し、`writeDeclIds` を呼び出し元へ
  合流する。`update_*()` の挿入位置は従来どおり呼び出し元ハンドラ末尾。
- 追跡対象として呼ばれた動きゾーン関数を、書き換え済みのモジュール
  スコープ関数宣言として出力に1回だけ emit する(マクロ展開はしない)。
- binding 未解決の呼び出し(グローバル等)は従来どおり素通し。binding は
  解決できるが動きゾーンの function 宣言でないもの(仮引数・ローカル宣言
  経由の呼び出し等)は `scope limit` で拒否する。

## Capabilities

### New Capabilities

- `cross-function-handler-writes`: ハンドラ/action 本体からの動きゾーン
  関数呼び出しの追跡 — binding 同一性確認、呼び出し先本体の再帰解析と
  `writeDeclIds` 合流、書き換え済み関数の出力への単一 emit、追跡不能な
  呼び出しの素通し/拒否の線引き。

### Modified Capabilities

(なし — `handler-statement-bodies` の既存要件は変えない。呼び出しの
追跡は既存の4文種制限・イベント引数規則の上に積む新規要件のみ)

## Impact

- `src/compiler/analyze.ts`: ハンドラ/action 解析の visitor に
  CallExpression の binding 解決・呼び出し先本体の再帰解析を追加。
- `src/compiler/render.ts`: 動きゾーン関数表(`handlerFns`)を呼び出し
  追跡でも参照。
- `src/codegen.ts`: 追跡対象として呼ばれた関数の書き換え済み本体を
  モジュールスコープに1回だけ emit。
- `src/compiler/state.ts`: emit 対象関数の記録を `CompilerState` に追加。
- テスト: 追跡・再帰・拒否・emit 単一性の各ケース。既存の
  `test/no-wrapper.test.ts` 面への影響(emit された関数が import 面を
  汚さないこと)。
