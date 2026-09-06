## 契約と実装

- [x] module共有signalの受入条件と非目標を定義する。
- [x] compiler stateとmodule linkerで直接`const signal()`を収集する。
- [x] 参照された共有signalだけをmodule scopeへ出力し、instanceごとの購読とunmount解除を生成する。
- [x] shared signal runtime helperと型境界を追加する。
- [x] 二つのinstance、unmount、未使用出力、unsupported stateの代表試験を追加する。
- [x] ADR、README、STATUS、ROADMAP、CONCEPT、architectureを更新する。

## 検証

- [x] `vp check`
- [x] 全試験
- [x] `bun run typecheck:tsc`
- [x] `bunx @fission-ai/openspec validate --all --strict`
- [x] `bun run build`
