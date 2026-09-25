## 方針

`AnimatePresence`はコンパイル前に取り除く。直下の条件分岐とkey付き一覧内にあるmotion要素を
識別し、`exit`をactionの設定へ渡す。余分なDOM要素は作らない。

構造更新中のaction破棄を汎用実行時処理の`isDomUpdateInProgress()`で判定する。
削除後のmicrotaskで要素を元の親へ戻し、Motionの`animate()`完了時に除去する。
部品全体の破棄では退場させない。

`mode="wait"`と`mode="popLayout"`は初回対象外として診断する。
