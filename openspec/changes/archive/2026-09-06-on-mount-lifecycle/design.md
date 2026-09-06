## Context

生成moduleは`createComponent()`内にinstance専有のstateを持ち、既にmount/hydrate、
top-level action、unmountの順序を生成している。新しい共有runtimeを導入せず、
component compilerが収集したcallbackを既存の初期化・破棄列へ追加する。

## Decisions

1. `splitComponentZones()`はrender後のfunction宣言に加えて、単独の
   `onMount(<zero-arg arrow>)`文を収集する。callbackの解析は既存action解析を再利用し、
   callback本体のsignal書き込みには`update_*()`を追加する。cleanup本体には追加しない。
2. `CompilerState.mounts`と`MountDecl`をaction列とは別に持つ。root componentだけが
   これを生成し、構造unitのsplice対象にはしない。
3. codegenはcleanupを返すcallbackだけにinstance変数を出力する。callbackはmarker収集、
   handler、構造unit初期化、action初期化の後で実行する。unmountでは構造unit、action、
   onMount cleanupの順に処理し、各列の中では逆順に処理する。
4. 初期化列はonMount使用時にtry/catchで囲む。失敗時は`unmount()`を呼び、既登録の
   cleanupを回収して元の初期化例外を再送出する。
5. cleanupの例外は既存のdestroy例外処理と同じく最初の例外を保存し、残りを処理してから
   再送出する。

## Boundary

子componentはコンパイル時にinline化されruntime instanceにならない。onMountを暗黙に
rootへ移すと所有権が変わるため、inline化時にscope limitで拒否する。構造unitの
movement zoneへonMountを移す受け皿も作らない。
