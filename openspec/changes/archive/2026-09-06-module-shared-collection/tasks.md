## 契約と実装

- [x] 1.1 ADR、proposal、design、正本specへmodule共有collectionの所有単位とscope limitを記録する。
- [x] 1.2 runtimeへkey index、置換、item更新、購読を持つshared collection accessorを追加する。
- [x] 1.3 compiler stateとmodule linkerで直接collection宣言を収集し、初期配列とkey selectorを出力する。
- [x] 1.4 Listの直接collection依存とshared collectionの購読・key照合をcodegenへ接続する。
- [x] 1.5 二つのinstance、unmount、key不一致、未使用出力、不正形の試験を追加する。
- [x] 1.6 STATUS、ROADMAP、README、architecture、CONCEPTの記述を更新する。

## 検証

- [x] `bun run check:fix`
- [x] 全試験
- [x] `bun run build`
- [x] `vp -C examples/consumer-app build`
- [x] `bunx @fission-ai/openspec validate --all --strict`
