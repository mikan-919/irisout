## 1. セットアップ

- [ ] 1.1 `react` / `react-dom`をdevDependencyに追加する(`bun add -d`)
- [ ] 1.2 `examples/todomvc.react.tsx`を新規作成し、React標準のkey付きリスト
      パターンでTodoMVC(追加・完了トグル・削除・フィルタ切り替え)を実装する

## 2. ベンチマークハーネス

- [ ] 2.1 `bench/todomvc-vs-react.ts`を新規作成し、`bench/listener-strategy.ts`
      と同じ作法(jsdom、`performance.now()`、`process.memoryUsage()`、
      `bun run`で単体実行)で骨格を用意する
- [ ] 2.2 SIZES = [100, 1_000, 10_000, 100_000]で両実装をマウントする
      セットアップ関数を実装する
- [ ] 2.3 初期マウント時間の計測を実装する
- [ ] 2.4 N件全アイテムの完了トグル時間の計測を実装する
- [ ] 2.5 フィルタ切り替え(all→active→completed)時間の計測を実装する
- [ ] 2.6 アイテム1件追加時間の計測を実装する(handwritten版は既存要素が
      再生成されないことも確認する)
- [ ] 2.7 アイテム1件削除時間の計測を実装する

## 3. 実行と結果まとめ

- [ ] 3.1 `bun run bench/todomvc-vs-react.ts`を実行し、全シナリオ・全Nの
      結果を取得する
- [ ] 3.2 結果を`bench/todomvc-vs-react.results.md`(または同等の
      レポートファイル)にまとめる
- [ ] 3.3 ADR-0005の見立て(keyed reuseのMapの帳簿コストはReact Fiberと
      同種)が裏付けられたか反証されたかの結論を明記する
- [ ] 3.4 結論をROADMAP.mdの該当項目(次のアクション4)に反映し、M5の
      設計判断材料として参照できるようにする
