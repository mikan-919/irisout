## 1. render.ts: `use`属性の受理

- [ ] 1.1 `collectAttrs()`に第3分類として`use`を追加(design Decision 1:
      属性名は`use`で確定)。識別子参照(`handlerFns`経由)とinline arrowを
      受理し、それ以外・`render()`より前の宣言参照・未解決参照は
      scope limitで拒否
- [ ] 1.2 リストアイテム/条件分岐ブランチ内(`insideUnit`)の`use=`を
      scope limitで拒否(design Decision 3)
- [ ] 1.3 対象要素にマーカー(`data-iris-id`)を付与し、action情報を
      ctxへ記録

## 2. analyze.ts: action本体の解析

- [ ] 2.1 action本体へ既存のハンドラ解析(識別子解決・書き込み書き換え・
      4文種検証・D3検証)を適用するエントリポイントを追加
- [ ] 2.2 ネストした関数式/arrowの本体への再帰書き換え+再帰4文種検証
      (design Decision 4-1)
- [ ] 2.3 本体トップレベルの`return <引数なし関数式>`を返り値クロージャ
      として分離(引数付き関数・関数以外の値はscope limitで拒否)し、
      クロージャ本体の依存を収集して`resolveToSignals()`でroot signalへ
      展開(design Decision 4-2)

## 3. codegen.ts: 呼び出しと配線

- [ ] 3.1 モジュールスコープに`let __use_<markerId>__;`を宣言し、
      mountComponent/hydrateComponentの共有行の末尾(populateの後)で
      action本体を実行・返り値を代入、直後にガード付きで初期1回実行
      (design Decision 2)
- [ ] 3.2 返り値クロージャの依存root signalの`update_*`本体へ
      `if (__use_<markerId>__) __use_<markerId>__();`を追加。返り値の
      無いactionには配線行・初期実行行を一切生成しない(design
      Decision 5)

## 4. テスト

- [ ] 4.1 受理系: mount時1回呼び出し(要素引数・populate後・
      `parentElement`取得可)/ネストしたリスナー内のsignal書き込みが
      代入+`update_*`になる/返り値クロージャが`update_*`から呼ばれ
      初期1回実行される/返り値なしactionは配線行を持たない
- [ ] 4.2 拒否系: `render()`より前の宣言参照・未解決参照・ユニット内
      `use=`・引数付き関数の返却・4文種外の文(いずれも`compile:`+
      `(scope limit)`書式)
- [ ] 4.3 位置的リアクティビティ: 返り値以外のネスト関数(rAFループ等)が
      `update_*`に配線されないこと

## 5. ドキュメント消し込み

- [ ] 5.1 ADR-0011のステータスを実装済み(change `use-action-impl`)に
      更新し、裁定2件(属性名`use`確定・初期実行タイミング)を反映
- [ ] 5.2 STATUS.md(制約: ユニット内`use=`未対応・JSX型宣言未実装)・
      ROADMAP.md(6c消し込み、JSX型検査基盤の論点を積む)を同期
