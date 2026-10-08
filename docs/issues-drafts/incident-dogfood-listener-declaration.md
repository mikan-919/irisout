# useの内部で監視関数を宣言すると拒否される

観測日: 2026-10-08。利用者試験Aの原文:

> 文書に「handler内の関数宣言は禁止」の明記はない。

## 再現

```jsx
import { render } from 'irisout'

export function App() {
  render(<p use={observe}>監視中</p>)
  function observe(element) {
    function receive() {
      element.setAttribute('data-received', 'true')
    }
    window.addEventListener('incident-ping', receive)
    return {
      destroy() {
        window.removeEventListener('incident-ping', receive)
      },
    }
  }
}
```

`compile: handler statement "FunctionDeclaration" is not supported yet (scope limit)`として拒否される。型検査だけでは検出されない。

## 対応

`docs/events-and-actions.md`へ`const`アロー関数の例を追加した。登録と解除に同じ関数を使う理由を説明した。本体の受入構文は変更していない。Aの操作検査では、文書全体を再読み込みせずに詳細と一覧を往復し、登録数0→1→0→1→0→1と受信数0→1を確認した。
