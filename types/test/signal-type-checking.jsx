const count = signal(1)

count()

// @ts-expect-error 数値signalへ文字列を書き込む誤用を検出する。
count('wrong type')

const items = signal([{ id: 1, text: 'a' }], (item) => item.id)
items.update(1, (item) => ({ ...item, text: 'b' }))

// @ts-expect-error キー付きsignalのキー型と異なる値を検出する。
items.update('1', (item) => item)

// @ts-expect-error collectionは廃止済みであり、グローバル宣言を持たない。
collection([], (item) => item.id)

export {}
