const count = signal(1)

count()

// @ts-expect-error 数値signalへ文字列を書き込む誤用を検出する。
count('wrong type')

const items = signal([{ id: 1, text: 'a' }])
items((previous) => previous.map((item) => ({ ...item, text: 'b' })))

// @ts-expect-error 更新関数はsignalと同じ値型を返す必要がある。
items(() => 'wrong type')

// @ts-expect-error collectionは廃止済みであり、グローバル宣言を持たない。
collection([], (item) => item.id)

export {}
