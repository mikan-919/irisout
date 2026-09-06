# ADR-0032: 非同期handlerの更新位置

## ステータス

決定済み・実装済み(2026-09-06)

## コンテキスト

handlerは関数本体の文字列だけを取り出して生成していた。そのため、作者が
`async function`を書いても生成されたarrowへ`async`が付かず、`await`を含む不正な
JavaScriptになった。

また、handler本体を一つの字句スコープとして解析していたため、
`Promise.resolve(value).then((value) => { state(value) })`の書き込みがhandler末尾の
更新に合流していた。handlerの呼び出しはPromise完了前に終わるので、更新は完了
callbackの実行時に必要になる。

## 決定

- handlerの識別子参照とinline arrowから、`async`属性を解析結果へ保持し、生成wrapperへ
  そのまま出力する。
- handlerの文本体と式本体は、actionで使っている関数スコープ解析を共有する。Promiseの
  `.then()`に渡したarrowを入れ子スコープとして解析し、signal書き込みと更新をその
  callbackの本体末尾へ置く。concise callbackは更新を含むブロックへ変換する。
- 親handlerの末尾には親自身の直接書き込みだけを更新として置く。入れ子callbackの
  書き込みは親へ重ねない。構造unitの局所signalは、既存のfactory更新へ解決する。
- `try`、`catch`、`finally`を含む文は受理しない。成功処理と失敗処理はPromiseの
  完了callbackと拒否callbackを使う。これは更新をどの経路のどの時点へ置くかを静的に
  定めるためである。ループ、`switch`、関数宣言など既存のhandler文種制限も維持する。

## 結果

解析開始のsignal書き込み、Promise成功時の結果書き込み、Promise拒否時の失敗書き込みを
一つのDOM表示で確認できる。native event listenerはhandlerの返すPromiseを待たないため、
`async` handlerの更新は`await`完了後に実行される。

入れ子callbackの書き込みを実行時の要求識別子で破棄する機構は持たない。処理の競合、
画面破棄後の応答、Workerとの通信はロードマップ第5段階でアプリ側の責務として扱う。

## 検証

`packages/compiler/test/async-handlers.test.ts`で、async handlerの生成とDOM更新、Promise
完了callbackのブロック形・concise形、成功・拒否callbackによる開始・結果・失敗表示、
`try/catch`のコンパイル時拒否を確認する。
