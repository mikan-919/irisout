# ADR-0042: SVG要素の描画と属性境界

## ステータス

**決定済み・実装済み**(change `svg-authoring`、2026-09-06)

## 背景

ヒートマップの地図や指標表示では、HTML要素だけでなくSVGの図形を直接記述できる
必要がある。現在のコンパイラは要素をHTML文字列へ出力するため、SVGを専用の
実行時部品として追加せず、HTML parserが作る名前空間と既存の属性更新を利用できる。

## 決定

### 1. SVG要素は既存の文字列生成経路で扱う

`svg`を起点とする要素木を初期HTMLへ出力し、mount/hydrate後は既存のmarker、
event、List、条件分岐、`use=`の経路を使う。ブラウザのHTML parserが`svg`以下を
SVG名前空間へ配置する。`foreignObject`の子はHTML名前空間へ戻す。

SVGの要素名は既存のJSX要素名のまま出力する。属性名の自動変換表は追加しないため、
`viewBox`や`stroke-width`など、出力先SVGが要求する綴りを作者が記述する。

### 2. 通常の動的属性は既存の`setAttribute`を使う

`class`、`fill`、`d`などの動的属性は既存の動的属性バインディングとして初期HTMLへ
焼き込み、更新時にSVG要素の`setAttribute`へ渡す。専用のSVG property表は生成しない。

### 3. 名前空間属性は静的文字列に限定する

SVG要素上の`xlink:*`、`xml:*`、`xmlns:*`は静的文字列属性として初期HTMLへ出力する。
`xlink:href`などの属性はHTML parserが正しい名前空間を作る経路を使う。名前空間属性の
動的値は、`setAttributeNS`と属性名前空間の更新規則を別に定める必要があるため、
scope limitで拒否する。SVG外の名前空間属性も拒否する。

### 4. 型定義

`@irisout/compiler/jsx`は`SVGElementTagNameMap`の要素をintrinsic JSX要素として受理し、
SVGイベントの`currentTarget`をSVG要素へ対応させる。名前空間属性は静的文字列型を
宣言する。型検査が通っても、要素位置や属性値の実行時scope limit検査は別に適用する。

## 結果

SVGは追加runtimeなしで既存の初期HTML、hydrate、直接DOM更新へ接続される。構造unitや
children slotの中にSVGを置いた場合も、親から受けた名前空間を引き継ぐ。動的名前空間
属性、属性名変換、SVG専用property更新、SVG animationは別契約とする。
