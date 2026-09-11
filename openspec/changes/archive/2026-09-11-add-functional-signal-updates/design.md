## Context

signalはコンパイル後に変数と更新関数へ変換される。キー付きsignalだけが索引と項目直接通知を持つが、配列を`map`や`filter`で作り直す記述では全体再調整が必要になる。

## Goals / Non-Goals

**Goals:** 値と配列の設定APIを統一し、関数形式でも既存の依存更新を一度実行する。

**Non-Goals:** `map`や`filter`の差分推論、項目更新の定数時間保証、関数をsignal値として直接設定する記法は対象外とする。

## Decisions

引数が関数なら現在値を一度渡し、返り値を次値とする。ローカルsignalはコンパイル時に代入へ変換し、module共有signalは実行時アクセサーで処理する。関数値を設定する場合は、次の関数を返す更新関数で包む。

配列の識別子はJSXの`key`だけで定義する。複数一覧が同じ配列へ異なるキー式を使う場合も、各一覧が自身の照合を行う。

## Risks / Trade-offs

- 配列更新は全項目を走査する → 現行の`map`と`filter`記述に一致する。性能問題は計測後にコンパイラ最適化として扱う。
- 関数値と更新関数を実行時だけでは区別できない → 関数引数を更新関数として定義する。

## Migration Plan

`signal(initial, keyOf)`を`signal(initial)`へ変更し、`.update()`を`signal(previous => next)`へ置き換える。JSXの`key`は維持する。
