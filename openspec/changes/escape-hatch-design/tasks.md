## 1. ADR起票

- [ ] 1.1 `docs/adr/0010-handwritten-js-escape-hatch.md`を新規作成し、
      design.mdのDecisions(共存の単位=JSX要素1つ、`<Escape mount={...}/>`
      マーカー、識別子参照ルール、teardown不要方針)を決定として記載する
- [ ] 1.2 検討した代替案(コンポーネント全体単位/専用ゾーン単位)と
      却下理由を記載する
- [ ] 1.3 ADR-0004(統治原則)・ADR-0008(ゾーン構造)との整合性を
      「この決定がこれまでの判断とどう整合するか」節にまとめる
- [ ] 1.4 未決定事項(`<Escape>`という名前の最終確認、M5 UNRESOLVED(06)/
      (07)との関係)を記載する
- [ ] 1.5 mount関数本体の追跡宣言参照の拒否(design.md Decision 5)と、
      `use=`(change `action-use-attribute`)との1軸の役割分担
      (Decision 6)を記載する

## 2. ドキュメント整合

- [ ] 2.1 `docs/architecture.md`に、escape hatchが既存のコンパイル
      パイプライン(scope limitでの拒否 vs `<Escape>`での明示的迂回)の
      どこに位置づくかを追記する(該当箇所があれば)
- [ ] 2.2 `ROADMAP.md`の「設計判断待ち」3番目の項目を「決定済み
      (ADR-0010)、実装は別change」に更新する
- [ ] 2.3 `ROADMAP.md`の「次のアクション」に、ADR-0010実装のための
      follow-up changeを新規項目として追加する

## 3. 実装changeへの引き継ぎ準備

- [ ] 3.1 本change単体では`src/`を変更しないことを明記したまま、
      実装に必要な影響範囲(`src/compiler/render.ts`のJSX要素解析、
      `src/codegen.ts`のコンテナ生成・mount呼び出しコード生成)を
      引き継ぎメモとして`docs/adr/0010-*.md`または本changeの`design.md`に
      残す
