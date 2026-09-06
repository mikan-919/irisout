## 背景

`compileProject`は複数moduleを一つの生成moduleへリンクできるが、module scopeのstateを
一律に拒否していた。そのため、複数のcomponent instanceが同じ小さな共有値を読む代表的な
用途を、component runtimeや汎用storeなしには記述できなかった。

## 変更

- `compileProject`に限り、module直下の単純な`const name = signal(initial)`を共有signalとして
  受理する。
- 参照された共有signalだけを生成moduleのmodule scopeへ一度出力し、各component instanceの
  update関数を購読させる。unmount時には購読を解除する。
- `compile(source)`の単一file APIは変更しない。module scopeの`derived`/`collection`、副作用文、
  `let`/`var`、分割代入は引き続き拒否する。
- 共有signalの初期化、更新、購読解除は同期処理とし、SSR分離、永続化、非同期scheduler、
  汎用store APIは追加しない。

## 非目標

- module scopeの`derived`/`collection`、循環module、動的module import。
- componentごとに異なるmodule共有state、SSR request単位の自動分離、hot reload時の保持。
- 共有stateを使わない生成物へのruntime importや購読管理の固定費。

## 影響

module linker、compiler state、codegen、runtimeへ最小の共有signal境界を追加する。
代表fixtureで二つのcomponent instanceが同じ値を読み、片方の更新が両方へ反映され、
unmount済みinstanceへ通知されないことを確認する。
