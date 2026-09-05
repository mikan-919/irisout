## 設計

### 1. コンパイル時の所有単位

`renderElement()`は要素の`use`属性を現在の構造unitへ記録する。
top-level actionは従来どおりroot markerのactionとして保持し、unit内actionは
`StructuralUnitBody.localActions`へ閉じ込める。local actionはroot marker Mapへ登録せず、
そのbodyを生成するfactoryが所有する。

action本体は既存のhandler解析を使う。action本体のwrite setは従来の更新経路へ合流し、
返り値の読み取り依存は`resultDeps`として別に保持する。返り値が関数ならupdate、object
なら`update`と`destroy`へ正規化する。関数返り値はcleanupとして再解釈しない。
初期化・destroyの例外経路を試験できるよう、action解析だけは`throw`文を明示的に受理し、
通常のhandler解析と追跡functionの4文種契約は変更しない。

unitのaction resultがroot signalを読む場合は、そのsignalを構造markerの依存へ追加する。
signalの更新はroot `update_*()`から生きたfactory handleの`update()`へ届く。unitまたは
祖先unitのlocal signalを読む場合は、現在factoryまたは祖先factoryのupdate式へ接続し、
local DeclIdをroot依存表へ出さない。字句スコープ外のlocal signalは`scope limit`で拒否する。

### 2. factory handleとライフサイクル

actionを含むfactoryは次のhandleを返す。

```ts
{
  el: Element
  update(next?: unknown): void
  mount(): void
  destroy(): void
}
```

`mount()`はDOM挿入後に一度だけ実行し、actionをsource orderで初期化する。actionの
updateはmount時の初期呼び出しを含む。factoryの`update()`はitem値・local binding・
内側unitを更新し、保持しているaction updateを呼ぶ。`mount()`と`destroy()`は内部の
状態フラグで二重実行を防ぐ。

Listはactionを含むbodyだけ`reconcileListWithLifecycle()`を使う。既存keyは同じhandleを
使い、item値を`update()`へ渡す。並べ替えではDOM順だけを調整し、actionの再初期化・
破棄を行わない。keyが脱落したitemはList Mapから外し、handleをdestroyしてDOMをremove
する。条件分岐はbranch切替時に旧handleをdestroyしてから新handleを作成・挿入・mount
する。同じbranchの更新ではhandleのupdateだけを呼ぶ。

### 3. 破棄順序

所有者から見た破棄順序を固定する。

1. rootではtop-level handlerを同一function identityでremoveする。
2. 各unitは破棄済みフラグを先に立て、local handlerをremoveする。
3. 子unitをsource orderで破棄する。List itemは登録順の逆順、conditionalは現在の
   branchを破棄する。
4. そのunit自身のaction `destroy`を登録順の逆順で呼ぶ。
5. rootではtop-levelのList/conditionalを破棄し、その後top-level action `destroy`を
   登録順の逆順で呼び、最後にcomponent-owned DOM・marker・template参照を解放する。

この順序は子が親actionより先に解放されるpost-orderである。keyed reorderはこの順序を
発生させない。

### 4. 例外とstale callback

destroyは各action・各sibling・DOM removeをtry/catchで囲み、最初の例外を保存したまま
残りを実行する。最後に最初の例外を再送出する。factoryのmount途中で後続actionの
初期化が失敗した場合は、すでに作成したresourceを逆順に解放し、作成済みDOMとList
recordを除去する。rootの初期化失敗も同じinstanceのunmountへ進める。

factoryのdestroyはフラグを先に立て、factory updateと子unitの再生成を停止する。
rootのunmountは`__mounted__`を先に解除するため、保持されたroot updateもno-opになる。
これにより破棄後の外部callbackはDOMを更新せず、List/conditionalを再生成しない。

### 5. 出力とruntimeの境界

actionを含まないbodyは従来のfactoryと`reconcileList()`を使い、action用helperをimport
しない。actionを含む生成物だけがnormalize、lifecycle List helperをimportする。
個別のaction関数は生成コードへ展開し、汎用registry・effect scheduler・event delegation
は導入しない。これはcompiler-first/direct DOMの境界と、counterのサイズ予算を保つためで
ある。
