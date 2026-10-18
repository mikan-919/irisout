# 公開版でLayoutのprops名とsignal名が重なるとSSRが二重呼出しになる

観測日: 2026-10-18。npm公開版0.3.7の試行Bで観測した。現行ソースでの再現は未確認である。

実装役の原文:

> SSR生成物のh1は `${__esc__(title()())}` となっていた。Layoutのprops名titleと、詳細のsignal名titleが一致している。本文ではtitle()を一度だけ呼んでいる。

## 再現

[最小再現](../../fixtures/published-incident-dogfood/attempts/b/repro/)を公開版0.3.7の隔離導入先で実行する。

```sh
bun repro/check.mjs
```

`Layout({ title, children })`へ`title={title()}`を渡し、ページの子要素にも`title()`を書く。生成されたSSRの`h1`は`title()()`となり、`render({ incident: { title: '決済API停止' } })`が`TypeError: title() is not a function`で失敗する。アプリの初回実装では詳細ページがHTTP 500だった。

## 回避と未解決

試行Bではページのsignal名を`subject`へ変更すると詳細SSRが成功した。生成物から選んだ回避策であり、同名を禁止する設計判断ではない。公開版の最小再現を保存物から再実行して同じ失敗を確認した。内部原因の確定、現行ソースでの再現と修正は次の段階で行う。

## 現行ソースでの修正（2026-10-18）

現行ソースでも最小再現が同じ例外となった。子の`children`を挿入してからpropsの束縛を再解析すると、挿入した親の`title()`が子のprops参照として捕捉されていた。挿入前に各propsの参照を保存し、その参照だけを置換する修正を行った。公開版0.3.7の観測と保存物は変更していない。回帰試験は保存した相対モジュールのSSRを実行し、同名・交差するpropsと仮引数順序を変えたmount/hydrateの更新も確認する。
