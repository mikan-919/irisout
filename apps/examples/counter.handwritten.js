// apps/examples/counter.jsx を、経験豊富な開発者が hydrate 前提で手書きしたと仮定した
// あるべき姿。焼き込み済み HTML(<div id="app"> 配下)を前提に、要素取得 +
// addEventListener + 更新関数のみを書く素の ESM。ランタイム(packages/runtime/src/index.ts)は
// 使わず、恣意的に切り詰めない普通の手書きコードとする。
// test/golden.test.ts のサイズ予算の分母(コメント行・空行を除いた byteLength)。

let count = 0

const app = document.getElementById('app')
const paragraph = app.querySelector('p')
const incrementButton = app.querySelector('button')

incrementButton.addEventListener('click', () => {
  count = count + 1
  render()
})

function render() {
  const doubled = count * 2
  paragraph.textContent = `count: ${count} / doubled: ${doubled}`
}

render()
