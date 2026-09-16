// 別ページのPlayground編集画面を初期化する。LPの生成物とコンパイラを共有しない。
import './styles.css'
import { setupPlayground } from './playground/client.js'

setupPlayground(document.querySelector('[data-playground-root]'))
