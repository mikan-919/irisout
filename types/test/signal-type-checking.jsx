const count = signal(1)

count()

// @ts-expect-error 数値signalへ文字列を書き込む誤用を検出する。
count('wrong type')

export {}
