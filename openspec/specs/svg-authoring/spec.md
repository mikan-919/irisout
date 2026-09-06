# svg-authoring

## Purpose

SVG要素を既存のJSX、初期HTML、直接DOM更新の経路で扱う。SVG専用の実行時部品を
追加せず、`svg`以下の要素へ名前空間を引き継ぐ。通常の動的属性、静的な
`xlink:*`/`xml:*`/`xmlns:*`名前空間属性、`foreignObject`のHTML子要素を規定する。

## Requirements

### Requirement: SVG要素の名前空間を保った描画
コンパイラは、`svg`を起点とするJSX要素木を既存の初期HTMLとmount/hydrate経路へ
出力し、ブラウザのHTML parserがSVG要素をSVG名前空間へ配置できる形を生成しなければ
ならない(SHALL)。SVG専用の実行時要素生成器を追加してはならない(SHALL NOT)。

#### Scenario: 図形要素をSVG名前空間へ配置する
- **WHEN** authoredコードが`<svg><circle /><path /></svg>`をrenderする
- **THEN** mount後の`svg`、`circle`、`path`が`http://www.w3.org/2000/svg`の
  namespaceURIを持ち、生成moduleは既存のmount経路だけを使う

### Requirement: SVGの通常属性を既存の更新経路へ接続する
コンパイラは、SVG要素の静的属性を初期HTMLへ出力し、式コンテナの通常属性を
既存の動的属性バインディングとして初期値へ焼き込み、更新時に`setAttribute`へ
接続しなければならない(SHALL)。SVG専用のproperty変換表を追加してはならない
(SHALL NOT)。

#### Scenario: 動的なclassと図形属性を更新する
- **WHEN** SVG要素が`class={active() ? 'active' : 'idle'}`と`r={radius()}`を持ち、
  handlerが両方のsignalを書き換える
- **THEN** 初期HTMLとhandler後のDOM属性がそれぞれのsignal値を反映する

### Requirement: SVG名前空間属性の静的出力
コンパイラは、SVG要素上の`xlink:*`、`xml:*`、`xmlns:*`属性を静的文字列値に
限って初期HTMLへ出力しなければならない(SHALL)。これらの動的値、許可外namespace、
SVG外の名前空間属性は`compile:`で始まり`(scope limit)`を含むエラーで拒否しなければ
ならない(SHALL)。

#### Scenario: xlink参照を初期HTMLへ出力する
- **WHEN** authoredコードが`<svg><use xlink:href="#shape" /></svg>`をrenderする
- **THEN** 初期HTMLが`xlink:href="#shape"`を含み、mount後の属性がXLink namespaceから
  `href`として取得できる

#### Scenario: 動的な名前空間属性を拒否する
- **WHEN** authoredコードが`<svg><use xlink:href={href()} /></svg>`をrenderする
- **THEN** コンパイラは静的文字列値を要求する`(scope limit)`エラーを返す

### Requirement: foreignObjectの子namespace
コンパイラは、SVG要素木の`foreignObject`直下のHTML要素へHTML namespaceを適用し、
その子の通常HTML属性とeventを既存経路で扱わなければならない(SHALL)。

#### Scenario: foreignObject内のHTML要素
- **WHEN** authoredコードが`<svg><foreignObject><div>text</div></foreignObject></svg>`を
  renderする
- **THEN** mount後の`div`が`http://www.w3.org/1999/xhtml`のnamespaceURIを持つ

### Requirement: SVG intrinsic JSX型
`@irisout/compiler/jsx`は、`SVGElementTagNameMap`の要素をintrinsic JSX要素として
型検査し、SVG要素の既知eventで`currentTarget`をSVG要素へ対応させなければならない
(SHALL)。`xlink:href`、`xml:space`、`xmlns:xlink`は文字列属性として受理する。

#### Scenario: SVG JSXと名前空間属性を型検査する
- **WHEN** authored `.jsx`が`svg`、`path`、`use`、`foreignObject`と静的
  `xlink:href`を使う
- **THEN** `typecheck:jsx`は型エラーを出さない
