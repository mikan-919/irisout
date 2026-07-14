# handwritten-js-escape-hatch

## Purpose

コンパイラ非対応パターンに遭遇した箇所を、手書きvanilla JSとして
共存させるための、authoring API上の記法(`<Escape mount={identifier} />`)と
コンパイラ側の受理ルール(ADR-0010)。共存の単位はJSX要素1つ。本capabilityは
設計(spec)のみを対象とし、コンパイラ実装(`src/`)は別changeで行う。

## Requirements

### Requirement: `<Escape>`マーカー要素によるJSX要素単位の共存
コンパイラは、UI木の任意の位置に置かれた`<Escape mount={identifier} />`を
組み込みマーカー要素として解釈し、その位置の中身をコンパイラの解釈対象から
除外しなければならない(SHALL)。`<Escape>`は子要素を持てない
(自己完結タグのみ受理する)。

#### Scenario: `<Escape>`を含むJSXの受理
- **WHEN** authored コンポーネントのUI木に`<Escape mount={setupWidget} />`
  がある
- **THEN** コンパイラはこの箇所を通常のJSX要素として解析せず、専用の
  マーカーとして扱い、compile errorを出さない

#### Scenario: 子要素を持つ`<Escape>`の拒否
- **WHEN** `<Escape>`が子要素(テキスト・式・他のJSX要素)を持つ
- **THEN** コンパイラは`compile:`で始まり`(scope limit)`を末尾に含む
  エラーを投げる

### Requirement: `mount`属性の識別子参照ルール
コンパイラは、`<Escape>`の`mount`属性を、ハンドラ属性
(`component-authoring-zones`)と同じ規約で解決しなければならない
(SHALL): `render()`より後ろに置かれた同名のfunction宣言への識別子参照
のみを受理し、それ以外の形式(inline arrow、`render()`より前の宣言への
参照など)は拒否する。

#### Scenario: 動きゾーンのfunction宣言への参照
- **WHEN** `<Escape mount={setupWidget} />`があり、`setupWidget`が
  `render()`より後ろのfunction宣言として存在する
- **THEN** コンパイラはこの参照を解決し、生成コードから`setupWidget`を
  呼び出すコードを生成する

#### Scenario: 未解決の識別子参照の拒否
- **WHEN** `<Escape mount={setupWidget} />`の`setupWidget`が`render()`
  より後ろのfunction宣言として存在しない
- **THEN** コンパイラは`compile:`で始まり`(scope limit)`を末尾に含む
  エラーを投げる

### Requirement: コンテナ要素の生成とmount呼び出し
コンパイラが生成するコードは、`<Escape>`の位置に空のコンテナDOM要素を
1つ生成し、そのコンポーネント(またはリストアイテム/条件分岐ブランチの
インスタンス)がマウントされる際に、対応する`mount`関数をそのコンテナ
要素を引数として1回だけ呼び出さなければならない(SHALL)。

#### Scenario: マウント時の呼び出し
- **WHEN** `<Escape mount={setupWidget} />`を含むコンポーネントが
  マウントされる
- **THEN** 生成されたコードは、その位置に生成したコンテナ要素を引数として
  `setupWidget(container)`を1回呼び出す

### Requirement: コンテナ内部への非関与
コンパイラは、`mount`関数がコンテナ要素の内部に対して行う操作(DOM生成・
イベントリスナー登録等)を一切解析・生成せず、実行時にも関与しては
ならない(SHALL NOT)。明示的なteardownコールバックの呼び出しも生成
してはならない(SHALL NOT)。

#### Scenario: コンテナ削除時の扱い
- **WHEN** `<Escape>`を含むリストアイテムがkeyed Mapから破棄され、DOM
  要素が`remove()`される
- **THEN** 生成されたコードは`mount`に対応するteardown処理を一切呼び出さず、
  コンテナ要素ごとDOM部分木を削除するのみ行う

### Requirement: mount関数本体のコンポーネント内宣言参照の拒否
コンパイラは、`mount`属性が参照するfunction宣言の本体に識別子スキャンを
行い、参照可能な識別子をmount自身の引数・ローカル宣言・モジュール
import・グローバルに限定しなければならない(SHALL)。コンポーネント内の
他の宣言(signal/derivedの追跡宣言・プレーンconst・他のfunction宣言)への
参照を見つけた場合、`compile:`で始まり`(scope limit)`を末尾に含むエラーを
投げなければならない(SHALL)。スキャンはスコープ解析を伴わない保守的な
ものでよく、mountのローカル宣言がコンポーネント内宣言と同名の場合の
誤検知は許容する(MAY)。本体のそれ以外の内容は解析しない(SHALL NOT)。

#### Scenario: signalを参照するmount関数の拒否
- **WHEN** `<Escape mount={setupWidget} />`の`setupWidget`本体が
  `count()`(追跡されたsignal)への参照を含む
- **THEN** コンパイラはcompile errorを投げ、実行時のTypeErrorとして
  静かに壊れることを許さない

#### Scenario: コンポーネント内の他のfunction宣言を呼ぶmount関数の拒否
- **WHEN** `setupWidget`本体が、同じコンポーネントの動きゾーンにある
  別のfunction宣言`helper`への参照を含む(`helper`本体がsignalを読むか
  どうかは問わない)
- **THEN** コンパイラはcompile errorを投げる(mount→helper→signalの
  推移的参照が実行時エラーとして静かに壊れる経路を塞ぐ)

#### Scenario: コンポーネント内宣言に触れないmount関数の受理
- **WHEN** `setupWidget`本体がDOM操作・独自のローカル変数・モジュール
  importや外部ライブラリ呼び出しのみで構成される
- **THEN** コンパイラは本体の内容を解析せず受理する
