## 設計

1. `renderElement`へSVG namespaceの状態を渡す。`svg`自身とSVG内の子要素はtrueを
   受け、`foreignObject`の子だけfalseへ戻す。List・条件分岐のfactoryへも同じ状態を
   引き継ぐため、構造unit内のSVG要素も同じHTML parser境界になる。
2. 通常の静的・動的属性の文字列生成と更新は変更しない。SVG上の動的`class`、`fill`、
   `d`なども`setAttribute`を使い、`checked`/`value`のproperty表をSVG用に広げない。
3. `JSXNamespacedName`はSVG要素上の`xlink`、`xml`、`xmlns`だけを静的StringLiteral
   として`name="namespace:localName"`へ変換する。その他の場所、namespace、値形は
   scope limitで拒否する。静的HTMLをparserへ渡すことでxlink属性namespaceを生成する。
4. JSX型はHTML intrinsic mapと重ならないSVG intrinsic mapを交差させる。重複するHTML/SVG
   要素の型統合や、文字列属性の厳密なSVG属性表は追加しない。
