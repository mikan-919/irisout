## 設計

`createAsyncContext`は`createContext`と同じcompile-time ContextIdを持ち、ContextDeclにasync
種別だけを記録する。provider値とdefault値は式文字列として保存し、`useContext`の
collectContextCallsが既存のAST置換と依存収集を行う。async種別はruntime分岐には使わず、
型宣言でPromiseLike<T>を保証する。
