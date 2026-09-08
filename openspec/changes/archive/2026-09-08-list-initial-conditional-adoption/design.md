## 設計

1. `initialConditionalBranch()`は、リスト項目スコープ、直接所有local signal、単純な
   真偽値初期化、rangeの存在を確認する。親bodyまたは選択枝にlifecycle・入れ子unit・
   localDeclがある場合は対象外にする。選択枝自身とrangeの祖先templateを調べ、SVG
   名前空間内ならclone経路へ戻す。
2. 対象枝は`initialTemplate()`でrangeアンカー間へ一度だけ埋め込む。branch factoryは
   `__existing__`を受け取り、初回だけrange開始アンカーの直後の要素を使う。条件ごとに
   `__cond_<id>_initial__`を持ち、初回updateの後は常にfalseにする。これにより、空枝
   へ遷移してstate値が初期値と同じ状態になっても、終了アンカーを再利用しない。
3. 初期枝の引き取り対象だけDOM再挿入を抑止する。対象外では従来の無条件
   `insertBefore()`文字列をそのまま生成し、lifecycle/actionのmount・destroy順序を
   変えない。
4. 項目ごとに異なる初期値、top-level条件、入れ子、SVG、lifecycleは既存branch
   clone経路を使う。keyed listの同一handle再利用はruntimeへ変更を加えず、枝切替時は
   新しいcloneと既存のstate/cache破棄規則を使う。
