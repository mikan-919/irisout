# ADR-0009: ハンドラの文レベル本体とイベントオブジェクトの受け渡し

## ステータス

**承認済み** — 推奨案(質問1〜5)をそのまま採用し、change
`adr-0009-handler-statements` で実装した。設計レベルの追加決定
(`IfStatement` 枝の再帰検証、書き込み後 `return` の拒否)は
`openspec/changes/adr-0009-handler-statements/design.md` の D2/D3 を参照。

## コンテキスト

決定済み ADR-0008(ゾーン API)は、ハンドラを `render()` 文より後ろの
**function 宣言(ブロック本体)**で書くと決めた。その ADR 自身が挙げる例
そのものが、現行コンパイラでは通らない:

```jsx
function handleCountUp() { state(state() + 1) }   // ADR-0008 の決定例
```

`src/compiler/render.ts` はハンドラを **単一式の inline arrow** に限定して
おり、ブロック本体と引数を明示的な scope limit として拒否する:

- 引数拒否 — `render.ts:239-245`:
  `if (exprPath.node.params.length > 0) throw ... "parameters are not
  supported yet (scope limit)"`
- ブロック本体拒否 — `render.ts:246-251`:
  `if (bodyPath.isBlockStatement()) throw ... "body must be a single
  expression, not a block (scope limit)"`

解析側 `src/compiler/analyze.ts` の `analyzeHandlerExpr`(`analyze.ts:141-207`)
は **単一式**を前提に、追跡対象識別子への「引数1個の呼び出し」
(`count(count() + 1)`)を書き込みとして検出し、`callee+開き括弧` と
`閉じ括弧` の2つの edit で `count = count + 1` へ書き換える。識別子解決は
`resolveDeclId`(`analyze.ts:27-37`)で、`idPath.scope.getBinding(...)` が
返す binding が `VariableDeclarator` かつその `start` が
`ctx.declIdByKey`(= top-level の `signal()`/`derived()` 宣言集合)にある
ときだけ追跡対象と見なす。

配線側 `src/codegen.ts:55` のハンドララッパーは **既に可変長引数**を受けて
いる:

```js
const __handler_${markerId}_${eventName} = (...__args) => { ${rendered}; ${updateCalls} };
```

つまりイベントオブジェクトは DOM リスナから配線上ラッパーまで届いており、
欠落は **解析側だけ**(引数の受け入れと本体内での参照解決)にある。

### 現行のnative event semantics

実装後の`render.ts`は`on[A-Z]...`属性の先頭2文字を除き、残りを
`toLowerCase()`してnative event名へ渡す。現行fixture/テストで確認できる対応は
`onClick`→`click`、`onChange`→`change`、`onInput`→`input`、
`onKeyDown`→`keydown`、`onDblClick`→`dblclick`、`onBlur`→`blur`である。
`codegen.ts`はroot handler・List item factory handler・conditional factory handler
のすべてで、optionsなしの`addEventListener(eventName, wrapper)`を生成する。

そのためhandlerの第1引数は、コンパイラ独自のイベントではなくブラウザが渡す
native event objectそのものである。`event.target`は元の発火元、
`event.currentTarget`は直接listenerを登録したhost/item elementであり、
`click`・`change`・`input`・`keydown`・`dblclick`のbubbling挙動や、
`blur`が通常bubbleしないことをcodegenが変換しない。現行のList/conditional系
testsはitem内のclick、dblclick、change、keydownを直接hostへdispatchし、
same-file component composition testはList item内のblurも直接hostへdispatchして
factory handlerを検証している(これらのhelper dispatchはtarget要素へ直接届かせる
ため、bubbling経路自体は検証しない)。TodoMVC fixtureもList itemの`onChange`、
`onDblClick`、`onKeyDown`、`onBlur`を含み、`e.target.value`を観測する。
これらのnative semanticsを親委譲で再現する設計は未決定である。

| authored属性 | native event | 通常の伝播 |
| --- | --- | --- |
| `onClick` | `click` | bubbling |
| `onChange` | `change` | bubbling |
| `onInput` | `input` | bubbling |
| `onKeyDown` | `keydown` | bubbling |
| `onDblClick` | `dblclick` | bubbling |
| `onBlur` | `blur` | non-bubbling (`focusout`とは別event) |

### この ADR が答えるべき具体的入力(`examples/todomvc.jsx`)

- **UNRESOLVED(09)** — イベントオブジェクト `e` の型付け
  (`examples/todomvc.jsx:107-118`)。`handleInputKeyDown(e)` は
  `e.target.value` へ素朴にアクセスする。この1関数だけで、本 ADR が扱う
  4種の文がすべて現れる:

```jsx
function handleInputKeyDown(e) {
  if (e.key !== 'Enter') return          // IfStatement + 早期 ReturnStatement
  const text = e.target.value.trim()     // VariableDeclaration(ローカル)
  if (text === '') return
  todos([...todos(), { id: Date.now(), text, completed: false }])  // 書き込み
  e.target.value = ''                    // イベント引数への代入
}
```

- 他のハンドラ(`toggleTodo(id)` / `removeTodo(id)` / `setFilter(next)` /
  `startEditing(id)`, `todomvc.jsx:120-136`)は、いずれも **function 引数
  (`id` / `next`)を本体で参照する**単一式ハンドラで、引数の scope 解決が
  必須であることを裏づける。

**この ADR は設計スパイクであり、成果物はこのドラフトのみ。`src/**`・
`test/**` の実装は本 ADR の承認後、別の変更で行う。**

## 検証(スクラッチ実験、非コミット)

`resolveDeclId` が依存する `getBinding()` が、ブロック本体でどう振る舞うかを
`@babel/parser` + `@babel/traverse` を直接使ったスクラッチで確認した
(コードは非コミット。以下は結果と最小コード片の引用)。判定関数は
`resolveDeclId` と同じ「binding が `VariableDeclarator` かつ start が
追跡集合にあるか」を再現した。入力:

```jsx
function C() {
  const count = signal(0)          // 追跡対象(top-level)
  function h(e) {                   // e: 関数引数
    if (e.key !== 'Enter') return   // 早期 return
    const count = 99                // ローカル(signal 名 count をシャドー)
    const text = e.target.value     // ブロックローカル
    if (text === '') { count; return }
    todos(text)                     // 追跡対象への書き込み
  }
}
```

観測結果:

```
L5 e     -> not-tracked (Identifier)          … 関数引数
L7 e     -> not-tracked (Identifier)
L8 text  -> not-tracked (local declarator)    … ブロックローカル
L8 count -> not-tracked (local declarator)    … シャドー:ローカルへ解決
L9 todos -> (追跡対象。早期 return の後でも traverse は到達)
L9 text  -> not-tracked (local declarator)
```

3つの検証項目の結論:

1. **ローカル変数の安全性(確認できた)** — ブロック内 `const text` は
   binding が `VariableDeclarator` だが start が追跡集合に無く、追跡対象
   外に落ちる。ローカル宣言を signal と取り違える危険はない。
2. **シャドーイング(確認できた)** — ローカル `const count` が top-level
   signal `count` を隠す場合、`getBinding()` は **最寄りのローカル**へ解決し、
   追跡対象外になる(`L8 count -> local declarator`)。もし外側へ解決して
   いたら `TRACKED` と出るはずで、そうならなかったことがシャドー安全性の
   証拠。関数引数(`e`)も binding 種別が `Identifier` なので同様に安全。
3. **早期 return・条件分岐内の書き込み(確認できた)** — `todos(text)` は
   2つの早期 return の後にあるが、`traverse` は制御フローを解釈せず全
   識別子を訪れるため到達する(`L9 todos`)。条件分岐内 `{ count; return }`
   の識別子も同様に拾える。これは **静的過剰近似**(実行時に到達しない
   書き込みも「書き込みうる」と見なす)であり、後述の設計質問3の裏づけ。

## 提案(5つの設計質問)

### 1. イベント引数(`e`)の受け渡し方式

**推奨案:** ハンドラの **第1仮引数名をそのままラッパーの仮引数名へ昇格**
する。`(e) => { ... }` / `function h(e) { ... }` は `(...__args)` を
`(e, ...__args)`(または第1引数のみ束縛)へ変え、本体内の `e` はそのまま
出力する。第1引数のみを初回スコープとし、**分割代入
(`({ target }) => ...`)は初回スコープ外**として scope limit で拒否する。

**根拠:** 配線は既に届いている(`codegen.ts:55` の `(...__args)`)。欠落は
解析側の「引数を受け入れ、本体で参照解決する」だけ。引数名は authored
識別子なので追跡対象 signal と衝突しても、スクラッチ検証2により
`getBinding()` がローカル(引数)へ解決し安全。分割代入を初回から入れると
束縛パターンの走査が増える割に TodoMVC は素の `e` しか要らない(UNRESOLVED(09))。

**検討した代案:**
- (a) 固定名 `__event__` を注入し authored `e` を書き換える — authored code
  が仕様である原則(ADR-0004)に反し、rename/go-to-def が壊れる。却下。
- (b) 分割代入まで初回スコープに含める — ADR-0007「安全に拒否、最小から
  拡張」に反する先取り。必要になった時点で別途拡張。

**型付け(UNRESOLVED(09))について:** `e` の静的型(生の `Event` か要素
種別で絞るか)は **本 ADR のスコープ外**として「未決定事項」へ切り出す。
受け渡し方式の決定に型の絞り込みは不要で、独立に決められる。

### 2. ブロック本体として最初に許す文種の最小集合

**推奨案:** `ExpressionStatement` / `VariableDeclaration`(`const`/`let` の
ローカル)/ `IfStatement` / `ReturnStatement` の **4種**を出発点とする。
ループ(`for`/`while`)・`try`/`catch`・`switch`・関数/クラス宣言は
**scope limit として明示拒否を維持**する。

**根拠:** この4種で `handleInputKeyDown`(todomvc.jsx:112-118)が過不足なく
書ける — 早期 return、ローカル `const`、条件分岐、書き込み式。ローカル
`VariableDeclaration` はスクラッチ検証1により安全に追跡対象外へ落ちる。
ADR-0007「安全に拒否」に沿い、未検証の文種は静かに通さず compile error。

**検討した代案:**
- (a) 式のみ(現状維持)を貫き、複文はゾーン外の派生 signal に押し出す —
  ADR-0008 の決定例 `function handleCountUp() { ... }` 自体が通らないまま
  になり、ADR 間で矛盾する。却下。
- (b) 最初から全文種を許す — ループ内書き込みの意味論(反復回数と update
  タイミング)が未検証。最小集合の外は拡張を別 ADR に委ねる。

### 3. 条件分岐内の書き込み検出の意味論

**推奨案:** **静的過剰近似を維持**する。`if (...) { count(1) }` の
`count` への書き込みは、その分岐が実行時に通るか否かに関わらず「このハンドラ
は count を書きうる」と見なし、対応する `update_*()` をラッパー末尾へ出す。

**根拠:** スクラッチ検証3のとおり `traverse` は制御フローを解釈せず、
現行 `analyzeHandlerExpr` の identifier 巡回(`forEachReferencedIdentifier`)
を文レベルへ広げるだけで自然にこの意味論になる。更新の取りこぼし(書いた
のに再描画しない)より、余分な `update_*()`(何も変わらなければ実質 no-op)
の方が **安全側の誤り**。ADR-0007 の「安全に拒否/過剰近似」の精神と一致。

**検討した代案:** 到達可能性解析で分岐ごとに書き込みを絞る — 早期 return を
跨いだ精密な解析が要り、実装コストに見合わない。誤りが「描画漏れ」側に倒れる
リスクの方が重い。却下。

### 4. `analyzeHandlerExpr` の文レベルへの拡張形

**推奨案:** 現行の **edit ベース設計をそのまま保つ**。単一式 `exprPath` を
受ける代わりに **文の配列(ブロック本体)**を受け、各文の全識別子に対して
同一の `visit`(読み取り→出力名へ、引数1個の追跡呼び出し→代入へ書き換え)を
適用する。書き込み検出・edit 生成・`writeDeclIds` 収集のロジックは
`analyze.ts:149-194` の `visit` を再利用し、走査対象を式から文へ広げるだけ。

**根拠:** `render`(`analyze.ts:54-69`)は `[start, end)` 区間に edit を
差し込む汎用関数で、式でも文の連なりでも同じく機能する。`resolveDeclId` の
scope 解決はブロックローカル・引数・シャドーを既に正しく扱う(スクラッチ
検証1・2)。**解析層を新設せず、入力の粒度だけを式→文へ上げる**のが最小。

**検討した代案:**
- (a) 文種ごとに専用のビジター(IfStatement 用・VariableDeclaration 用…)を
  書く — one-implementation の抽象。edit ベースの単一 `visit` で足りるので
  不要。却下(ADR-0007 の「安全に拒否」ではなく、こちらは YAGNI)。
- (b) AST を書き換えて再生成(`@babel/generator`)する — 現行は source の
  区間コピー+edit でフォーマットを保つ設計。generator 導入は出力の見た目を
  変え、既存のゴールデン出力テストと衝突する。却下。

### 5. ADR-0008(識別子参照+巻き上げ function 宣言)との接続

**推奨案:** 本 ADR は ADR-0008 の **解析層の前提を埋める**位置づけとする。
ADR-0008 は「ハンドラは `render()` より後ろの function 宣言で、JSX からは
識別子参照」という **配置**を決めた。本 ADR はその function 宣言の
**本体(文レベル)と引数**をどう解析するかを決める。inline arrow 併存
(ADR-0008)も同じ `visit` で扱えるため、**巻き上げ function 宣言 /
inline arrow の両方が同一の文レベル解析を共有**する。

**根拠:** ADR-0008 は本体解析を「実装が新設する」とだけ述べ中身を未規定に
した。これを別 ADR で決めると `analyze.ts` を二度設計するリスク(proposal
の Why)。両者は同じ解析層を触るので1本にまとめる。

**検討した代案:** ADR-0008 の実装計画(M4.5)の中で暗黙に決める —
イベント引数(どの ADR も規定せず)が設計判断として埋もれ、レビュー機会を
失う。明示的に ADR 化して却下。

## 受け入れた代償

- **静的過剰近似(質問3)**により、実行時に到達しない分岐の書き込みも
  `update_*()` を出しうる。無駄な再計算が増えるが no-op に倒れる安全側の
  誤りとして受容。
- **最小文種(質問2)**に留めるため、ループを使うハンドラは当面書けない。
  TodoMVC は不要で、必要時に別 ADR で拡張する運用コストを受容。

## 未決定事項(後続で詰める)

- **イベント `e` の静的型付け(UNRESOLVED(09))** — 生の `Event` のままか、
  ハンドラ名(`onKeyDown` 等)や要素種別で `target` を絞るか。受け渡し方式
  とは独立に決められるため、本 ADR では切り出す。
- **`getBinding()` の前提が崩れる発見はなかった** — スクラッチ検証で
  `resolveDeclId` の設計前提(ローカル・引数・シャドーを追跡対象外へ落とす)
  は成立を確認済み。もし将来の文種拡張で崩れたら、その時点で別途記録する。
- **ADR-0008 との矛盾は検出されなかった** — 本ドラフトは ADR-0008 の
  未規定部分を埋めるだけで、既存決定を覆さない。レビューで推奨案が却下された
  場合の代案採用はユーザー判断を仰ぐ。

(実装順序は M4 → ADR-0008 実装(M4.5)→ M5。本 ADR は M4.5 の計画着手前に
承認されている必要がある — ROADMAP 参照)
