## 1. ADR起票

- [ ] 1.1 `docs/adr/0011-element-use-action.md`を新規作成し、design.mdの
      Decisions(3原則、use=属性、シグネチャと型、本体解析、返り値
      クロージャ、ref不採用と3チャネル)を決定として記載する
- [ ] 1.2 検討した代替案と却下理由を記載する: ref primitive(値の箱 —
      ゾーン構造が構造的に禁止)、属性名`on=`/`mount=`、返り値=cleanup
      (Svelte 5同型)、`untrack()` primitive(位置的リアクティビティ
      により不要)、文字通りのUI先頭(TDZ/TS2448)
- [ ] 1.3 ADR-0004(統治原則)・ADR-0005(factoryイディオム・teardown
      不要)・ADR-0008(識別子参照・ゾーン構造)・ADR-0009(本体解析)
      との整合性を「この決定がこれまでの判断とどう整合するか」節に
      まとめる
- [ ] 1.4 未決定事項(reactive params、複数要素action、第4チャネル
      「牙抜きref」のトリガー条件)を記載する
- [ ] 1.5 scope limit苦情のtriage手続き(Q1: 手書きで綺麗に書けるか /
      Q2: プラットフォームイディオムがあるか)を記載する

## 2. ドキュメント整合

- [ ] 2.1 `ROADMAP.md`のUNRESOLVED(01)を「決定済み(ADR-0011)、実装は
      別change」に更新する
- [ ] 2.2 `ROADMAP.md`の「次のアクション」にADR-0011実装のfollow-up
      changeを追加する(M5との実装順序も明記)
- [ ] 2.3 CONCEPT.v2.mdへの3原則・仮説(「書きづらいものは設計が
      間違っている」の極限定理)の昇格の要否をユーザーに確認し、要る
      場合は別途反映する
- [ ] 2.4 `examples/todomvc.jsx`のUNRESOLVED(01)注記(`const x = ref()`
      暫定構文)を本designの結論(use=採用・ref不採用)に合わせて更新する

## 3. 実装changeへの引き継ぎ準備

- [ ] 3.1 本change単体では`src/`を変更しないことを明記したまま、実装に
      必要な影響範囲を引き継ぎメモとして残す:
      `src/compiler/render.ts`(use属性の解析・識別子解決)、
      `src/compiler/analyze.ts`(ネストした関数への再帰書き換え・
      返り値クロージャの依存解析)、`src/codegen.ts`(mount時呼び出し・
      初期実行・update_*への配線)、JSX型定義(use属性の要素別宣言)
