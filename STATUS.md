# irisout 実装ステータス

実装の「今」の状態(現在地・マイルストーン進捗・既知の制約)をまとめたもの。
設計判断待ちの論点・次のアクションの計画は `ROADMAP.md` を参照。

## 現在地(2026-07-18)

TypeScript書き直しは M5.5(ネストした構造ユニット)+`use=`アクション
(ADR-0011)まで完了。「使ってもらえる閾値」(M5+`use=`)に到達済み
(proposal参照)。`legacy/`(元のJS実装)は参照専用で以後メンテナンスしない。

2026-07-18: mount/hydrate 時のマーカー存在検証を追加(change
`loud-hydration-mismatch`)。DOM と生成コードの不一致は黙って no-op に
ならず、欠落 ID を列挙して throw する。この検証はランタイム固定費として
`dist/app.js` に乗るため、サイズ予算係数を 3x → **4x** へ明示的に変更
(生成コード側の肥大化ではない。係数を締め直すのは M6 のスコープ)。

## マイルストーン表

| M | 内容 | 状態 | 備考 |
|---|------|------|------|
| M1 | スキャフォールド、signal/derived、テキストマーカー | **DONE** | `0155e85` |
| M2 | イベントハンドラ、書き込みトリガー更新 | **DONE** | `810bc83`→`645a820`、plan 005 |
| M3 | ブラウザビルドターゲット(hydrate/mount分割 + `scripts/build.ts`) | **DONE** | `a2905c8`、plan 001 |
| M4 | 静的host要素属性 | **DONE** | `9829f88`、change `m4-static-host-attributes` |
| M4.5 | authoring APIゾーン化(ADR-0008) | **DONE** | change `authoring-api-zones`。render()マーカー・識別子参照ハンドラ・ゾーン配置強制 |
| M5 | list/conditional factory closures、1階層のみ(ADR-0005の新実装) | **DONE** | change `m5-list-conditional-factory-closures`。ネストした構造ユニット(06/07)は据え置き |
| M5.5 | ネストした構造ユニット(条件分岐の中のリスト/リストアイテムの中の条件分岐、UNRESOLVED-06/07) | **DONE** | change `m5-5-nested-structural-units`。1階層ネストのみ、2階層以上は引き続きscope limit |
| `use=` | top-level要素へのaction接続(ADR-0011) | **DONE** | change `use-action-impl`。ユニット内`use=`・JSX型宣言は未実装のまま(下記制約参照) |
| M6 | 全マイルストーン横断のno-wrapper検証 | TODO | M4・M5完了後 |

## 既知の制約(現時点のcodegenの限界)

- **ルートコンポーネントは1つだけ**: `compile()`は「他から一度も参照
  されないトップレベル関数」がちょうど1つであることを要求し、そうで
  なければcompile error(`src/compiler.ts`のscope limit)。
- **トップレベルは関数宣言のみ**(2026-07-18、change `scope-limit-coverage`):
  Program 直下は関数宣言(`export` 付き含む)以外(import・トップレベル
  `const`・副作用式等)を `scope limit` で一律拒否する。現状の実装では
  出力に反映されず黙って捨てられるため、拒否が正直な挙動。分割代入宣言子
  (`const [a] = signal(0)` 等)も同様に拒否。ビルド時実行の例外は
  `compile: build-time execution failed:`(`cause` 付き)に包まれる。
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
- **リスト(`.map()`)・条件分岐(三項/`&&`)はM5+M5.5で実装済み**
  (change `m5-list-conditional-factory-closures` /
  `m5-5-nested-structural-units`)。ネストは1階層まで(リストアイテム内の
  条件分岐/条件分岐ブランチ内のリスト)。以下は明示的な scope limitで
  拒否する:
  - 2階層以上のネスト(ネストした構造ユニットの内側に、さらに別の構造
    ユニットがある場合)。
  - リスト/条件分岐の式コンテナが親要素の唯一の子でない場合(兄弟要素との
    混在)。コメントアンカー機構を持たないための単純化。ネストした構造
    ユニットにも同様に適用される。
  - リストアイテム本体・条件分岐ブランチ本体の中のテキストで追跡対象の
    signal/derivedを直接参照すること(item要素のフィールド参照は対象外 ―
    trackされないので素通りする)。ネストした構造ユニットの条件式・配列式
    はこの制限の対象外(依存は外側マーカーへバブルアップし、正しく更新が
    届く)。ハンドラ内での signal 読み書きも対象外(通常のハンドラと同じ
    仕組みで動く)。
  - リストアイテムに `key` 属性がない場合、または `key` が追跡対象の
    signalを参照する場合。
  - `.map()` のコールバックがブロック本体(`=> { ... }`)の場合(concise
    bodyのみ対応)。
- **フィルタ全件除外時の状態破棄**(M5.5、design.md Decision 2): 条件分岐
  ブランチにネストしたリストは、外側の条件分岐が選択を切り替えてリスト
  全体を非マウントにした瞬間、keyed Map・ローカル状態が(フィルタで
  非可視だっただけのアイテムも含めて)全件破棄される。「フィルタ除外時の
  状態保持」保証は、そのリスト自身がDOM上にマウントされ続けている間に
  限られる(spec「配列脱落とフィルタ除外の区別」の境界条件)。
- ハンドラ(inline arrow / 識別子参照の function宣言 どちらも)のブロック
  本体は4文種(式文 / `const`・`let` / `if` / 裸の `return`)に限る
  (ADR-0009)。第1仮引数(イベントオブジェクト)は authored 名のまま受け渡す
  が、分割代入・第2引数以降は `scope limit` で拒否する。ループ・
  `try`/`switch`・関数/クラス宣言・`var`・値を返す `return`、および
  ソース順で追跡書き込みより後ろの `return` も同様に `scope limit` で拒否
  する(D3: 末尾 `update_*()` の取りこぼしを防ぐため)。
- **`use={fn}`アクション(ADR-0011、change `use-action-impl`)はtop-level
  要素のみ実装済み**。以下は明示的な scope limit・別changeへの先送り:
  - リストアイテム/条件分岐ブランチ内の`use=`は返り値クロージャの動的
    レジストリが未実装のため`scope limit`で拒否(design.md Decision 3)。
    実需(アイテム内canvas等)が出た時点で別change。
  - JSX型定義(`JSX.IntrinsicElements`の`use`宣言)は未実装(design.md
    Decision 6)。authored `.jsx`の型検査基盤自体が未整備なため、それを
    一括整備する別changeで扱う。
  - reactive params・複数action・cleanupはADR-0011の未決定事項のまま
    (実需が出るまで作らない)。
  - action本体のconcise arrow(単一式)にネストしたリスナー等がある場合、
    その内部の書き込みに対する`update_*`挿入位置は本体全体の実行時点に
    まとまる(リスナー発火時ではない)。ブロック本体は正しく分離される
    (`src/compiler/analyze.ts`の`analyzeActionExprScope`コメント参照)。
