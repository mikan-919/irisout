# irisout 実装ステータス

実装の「今」の状態(現在地・マイルストーン進捗・既知の制約)をまとめたもの。
設計判断待ちの論点・次のアクションの計画は `ROADMAP.md` を参照。

## 現在地(2026-07-05, commit `a2905c8`)

TypeScript書き直しは Milestone 3 まで完了・`feat/first-concept`にマージ済み。
`legacy/`(元のJS実装)は参照専用で以後メンテナンスしない。

## マイルストーン表

| M | 内容 | 状態 | 備考 |
|---|------|------|------|
| M1 | スキャフォールド、signal/derived、テキストマーカー | **DONE** | `0155e85` |
| M2 | イベントハンドラ、書き込みトリガー更新 | **DONE** | `810bc83`→`645a820`、plan 005 |
| M3 | ブラウザビルドターゲット(hydrate/mount分割 + `scripts/build.ts`) | **DONE** | `a2905c8`、plan 001 |
| M4 | 静的host要素属性 | **DONE** | `9829f88`、change `m4-static-host-attributes` |
| M4.5 | authoring APIゾーン化(ADR-0008) | TODO | M4の後・M5の前(順序はROADMAP参照) |
| M5 | list/conditional factory closures(ADR-0005の新実装) | TODO | M4.5(API変更)の後に着手 |
| M6 | 全マイルストーン横断のno-wrapper検証 | TODO | M4・M5完了後 |

## 既知の制約(現時点のcodegenの限界)

- **ルートコンポーネントは1つだけ**: `compile()`は「他から一度も参照
  されないトップレベル関数」がちょうど1つであることを要求し、そうで
  なければcompile error(`src/compiler.ts`のscope limit)。
- **複数インスタンス不可**、ただし2つの別物が混ざっているので分けて書く:
  - (a) *リスト内でのN件ベンチマーク*(例: 1コンポーネント内で1万件の
    リストアイテムを持つ場合の性能・状態保持)は、ADR-0005のfactory
    closureがそのまま解決する。M5が入れば再現・検証できるようになる。
  - (b) *トップレベルコンポーネント自体の複数mount*(同じコンポーネントを
    2つ以上のコンテナへ`mountComponent`/`hydrateComponent`する)は別問題。
    `__markers__`・`update_*`がモジュール直下スコープで生成される設計
    (`src/codegen.ts:68`の`let __markers__;`)のため、M5(list item
    factory closure)が入っても解消しない。トップレベルのmount/hydrate
    自体をfactory化する変更が別途必要になるが、**未計画・未着手**で、
    ロードマップ上のどのマイルストーンにも属さない。実需が出た時点で
    設計判断すること。
    (補足) Reactの`ref`が条件分岐で`null`になるのとは性質が違う ―
    Reactのnullは「要素が今存在するか」を表す正常な状態遷移だが、
    `__markers__`のnullは「同じ変数を複数のライフサイクルインスタンスで
    共有している」ことそのものが原因で、mount/hydrateのたびに正しく
    出し入れされる設計にはなっていない。根本的な違和感は「`__markers__`が
    暗黙に(呼び出し順序の慣習だけを頼りに)書き込まれる」こと自体にある。
    ADR-0005のfactory closureパターンをトップレベルにも広げれば構造的に
    解消できるが、それはAPIの大きな変更を伴う。実需が出るまでは着手しない
    (2026-07-05 grillingで確認済み)。
- 条件分岐・リストはまだ未実装(M5)。静的host属性はM4で実装済み。
  動的(式コンテナ)host属性値はM4スコープ外で、引き続きcompile error
  (`scope limit`)で拒否する ― post-M6のパリティ穴。
