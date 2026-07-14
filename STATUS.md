# irisout 実装ステータス

実装の「今」の状態(現在地・マイルストーン進捗・既知の制約)をまとめたもの。
設計判断待ちの論点・次のアクションの計画は `ROADMAP.md` を参照。

## 現在地(2026-07-14)

TypeScript書き直しは M5(1階層のリスト/条件分岐)まで完了・
`feat/first-concept`にマージ済み。`legacy/`(元のJS実装)は参照専用で
以後メンテナンスしない。

## マイルストーン表

| M | 内容 | 状態 | 備考 |
|---|------|------|------|
| M1 | スキャフォールド、signal/derived、テキストマーカー | **DONE** | `0155e85` |
| M2 | イベントハンドラ、書き込みトリガー更新 | **DONE** | `810bc83`→`645a820`、plan 005 |
| M3 | ブラウザビルドターゲット(hydrate/mount分割 + `scripts/build.ts`) | **DONE** | `a2905c8`、plan 001 |
| M4 | 静的host要素属性 | **DONE** | `9829f88`、change `m4-static-host-attributes` |
| M4.5 | authoring APIゾーン化(ADR-0008) | **DONE** | change `authoring-api-zones`。render()マーカー・識別子参照ハンドラ・ゾーン配置強制 |
| M5 | list/conditional factory closures、1階層のみ(ADR-0005の新実装) | **DONE** | change `m5-list-conditional-factory-closures`。ネストした構造ユニット(06/07)は据え置き |
| M5.5 | ネストした構造ユニット(条件分岐の中のリスト/リストアイテムの中の条件分岐、UNRESOLVED-06/07) | TODO | M5のfollow-up。design.md Decision 1参照、未計画 |
| M6 | 全マイルストーン横断のno-wrapper検証 | TODO | M4・M5完了後 |

## 既知の制約(現時点のcodegenの限界)

- **ルートコンポーネントは1つだけ**: `compile()`は「他から一度も参照
  されないトップレベル関数」がちょうど1つであることを要求し、そうで
  なければcompile error(`src/compiler.ts`のscope limit)。
- **複数インスタンス不可**、ただし2つの別物が混ざっているので分けて書く:
  - (a) *リスト内でのN件ベンチマーク*(例: 1コンポーネント内で1万件の
    リストアイテムを持つ場合の性能・状態保持)は、ADR-0005のfactory
    closureで解決済み(M5)。
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
- 静的host属性はM4で実装済み。動的(式コンテナ)host属性値はM4スコープ外で、
  引き続きcompile error(`scope limit`)で拒否する ― post-M6のパリティ穴。
- **リスト(`.map()`)・条件分岐(三項/`&&`)はM5で1階層のみ実装済み**
  (change `m5-list-conditional-factory-closures`)。以下は明示的な
  scope limitで拒否する:
  - リストアイテム内・条件分岐ブランチ内にさらにネストしたリスト/条件分岐
    (UNRESOLVED-06/07、design.md Decision 1。follow-up = M5.5)。
  - リスト/条件分岐の式コンテナが親要素の唯一の子でない場合(兄弟要素との
    混在)。コメントアンカー機構を持たないための単純化。
  - リストアイテム本体・条件分岐ブランチ本体の中で追跡対象のsignal/derived
    を直接参照すること(item要素のフィールド参照は対象外 ― trackされない
    ので素通りする)。ハンドラ内での signal 読み書きはこの制限の対象外
    (通常のハンドラと同じ仕組みで動く)。
  - リストアイテムに `key` 属性がない場合、または `key` が追跡対象の
    signalを参照する場合。
  - `.map()` のコールバックがブロック本体(`=> { ... }`)の場合(concise
    bodyのみ対応)。
- ハンドラ(inline arrow / 識別子参照の function宣言 どちらも)のブロック
  本体は4文種(式文 / `const`・`let` / `if` / 裸の `return`)に限る
  (ADR-0009)。第1仮引数(イベントオブジェクト)は authored 名のまま受け渡す
  が、分割代入・第2引数以降は `scope limit` で拒否する。ループ・
  `try`/`switch`・関数/クラス宣言・`var`・値を返す `return`、および
  ソース順で追跡書き込みより後ろの `return` も同様に `scope limit` で拒否
  する(D3: 末尾 `update_*()` の取りこぼしを防ぐため)。
