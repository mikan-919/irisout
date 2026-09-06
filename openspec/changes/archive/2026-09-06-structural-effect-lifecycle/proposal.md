## Why

Root `effect`は実装済みだが、構造unitとinline子componentには所有者がなく、リストitemの
local signalやbranchの生存期間に副作用を接続できない。既存factoryのmount/update/destroy
を所有単位として利用し、汎用schedulerを増やさず実用的なunit effectを受理する。

## What Changes

- list item・conditional branchの`effect`を現在のfactoryへ収集する。
- inline子componentのeffectをroot、list item、conditional branchの所有範囲へ移す。
- local signalとroot signalの既存更新経路へeffect再実行を接続し、cleanupを逆順で破棄する。
- effectがないunitには専用生成物を出力しない。

## Non-goals

- 汎用effect registry、scheduler、非同期実行、context、module共有state。
- effect本体から追跡signalへ書き込む再入。

## Impact

- compilerの構造unit状態、render、inline化、factory codegenを変更する。
- structural effectの受入試験とOpenSpec/ADR/状態文書を追加する。
