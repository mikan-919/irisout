// SSRページのstateを使って運営部品をhydrateする。source文字列を実行管理画面へ送らない。
import { hydrateComponent } from 'virtual:irisout-playground-page'

const container = document.getElementById('app')
const stateElement = document.getElementById('playground-state')
if (container && stateElement) {
  try {
    const state = JSON.parse(stateElement.textContent ?? '')
    hydrateComponent(container, state)
    const duplicate = document.querySelector('[data-playground-duplicate]')
    if (duplicate instanceof HTMLButtonElement) {
      duplicate.addEventListener('click', () => {
        const source = state?.input?.record?.source
        if (typeof source !== 'string') return
        sessionStorage.setItem('irisout.playground.duplicate-source', source)
        location.href = '/#playground'
      })
    }
  } catch {
    // state不正時はSSR本文を残し、ページ全体を空にしない。
  }
}
