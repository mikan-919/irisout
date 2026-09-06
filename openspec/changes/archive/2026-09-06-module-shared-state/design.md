## 設計

### 契約

受理する形は、リンク後のmodule直下にある単純な

```js
const count = signal(0)
```

だけとする。`compileProject`がmodule bindingを衛生的な名前へ変更した後にcompilerが宣言を
収集するため、別moduleからimportした値も同じdecl graphへ解決できる。初期値は一つの引数
としてbuild-time executionと生成moduleへ渡す。`compile(source)`は従来どおり受理しない。

### 生成境界

参照された宣言だけについて、生成moduleへ次を出力する。

```js
const count = __sharedSignal__(0)
```

`__sharedSignal__`は値と購読集合だけを持つ専用runtime helperである。component instanceの
生成時に`count.subscribe(update_count)`を登録し、unmount時に返された解除関数を一度だけ
呼ぶ。setterは現在の購読者へ同期通知する。未参照宣言ではhelper import、共有宣言、購読
slotを出力しない。

shared signalのread callは通常のsignalと異なり生成後も`count()`として残す。これにより
module scopeの同一cellを全instanceから読む。書き込みも`count(next)`として残し、購読した
instanceの専用updateがDOMを更新する。effectの依存にも既存のsignal逆引きを使う。

### 境界と拒否

module scopeの`derived`/`collection`は、共有値の再計算・keyed状態の所有者が未定義なため
今回の契約では拒否する。context、effect、onMountの既存の静的経路は変更しない。共有signalを
使わないmoduleには共有runtimeを輸送しない。

### 受入条件

- 二つの生成component instanceが同じmodule signalを読み、一方のsetterで両方のDOMが更新される。
- 一方をunmountした後のsetterは残ったinstanceだけを更新する。
- 未使用module signalの生成物に`sharedSignal`と共有名が現れない。
- `compileProject`のmodule scope `derived`/`collection`は原因付き`compile:`エラーになる。
