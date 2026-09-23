// 全ページ共通の見た目と、要素が存在するページだけで動く補助処理を読み込む。
import './home.css'
import './playground.css'
import './examples/index.css'
import './examples/bcf-copy-button.css'
import './examples/task-board.css'
import './examples/morph-bcf.css'
import './line-seed.css'
import './playground-entry.js'

const revealedElements = new WeakSet()
const revealObserver = new IntersectionObserver(
  (entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue
      entry.target.classList.add('on')
      revealObserver.unobserve(entry.target)
    }
  },
  { threshold: 0.12, rootMargin: '0px 0px -12% 0px' },
)

function initializeReferenceSite() {
  document.querySelectorAll('.reference-site .reveal').forEach((element, index) => {
    if (revealedElements.has(element)) return
    revealedElements.add(element)
    if (element.getBoundingClientRect().top < innerHeight * 0.94) {
      setTimeout(() => element.isConnected && element.classList.add('on'), 140 + (index % 3) * 70)
    } else {
      revealObserver.observe(element)
    }
  })
  updateHeader()
}

function updateHeader() {
  document
    .querySelector('.reference-site #siteHeader')
    ?.classList.toggle('is-scrolled', window.scrollY > 8)
}

window.addEventListener('scroll', updateHeader, { passive: true })
new MutationObserver(initializeReferenceSite).observe(document.querySelector('#app'), {
  childList: true,
  subtree: true,
})
initializeReferenceSite()

let copyResetTimer
document.addEventListener('click', async (event) => {
  const target = event.target instanceof Element ? event.target : null
  const copyButton = target?.closest('.reference-site #copy')
  if (copyButton) {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText('npm install irisout')
      } else {
        throw new Error('Clipboard API unavailable')
      }
    } catch {
      const textarea = document.createElement('textarea')
      textarea.value = 'npm install irisout'
      textarea.setAttribute('readonly', '')
      textarea.style.position = 'fixed'
      textarea.style.opacity = '0'
      document.body.appendChild(textarea)
      textarea.select()
      document.execCommand('copy')
      textarea.remove()
    }
    copyButton.classList.add('is-copied')
    copyButton.setAttribute('aria-label', 'コピーしました')
    clearTimeout(copyResetTimer)
    copyResetTimer = setTimeout(() => {
      if (!copyButton.isConnected) return
      copyButton.classList.remove('is-copied')
      copyButton.setAttribute('aria-label', 'npm install irisout をコピー')
    }, 1200)
    return
  }

  const counterButton = target?.closest('.reference-site #plus, .reference-site #minus')
  if (!counterButton) return
  const resultPane = document.querySelector('.reference-site #resultPane')
  const writeTarget = document.querySelector('.reference-site #writeTarget')
  writeTarget?.classList.add('active')
  resultPane?.classList.remove('flash')
  if (resultPane) void resultPane.offsetWidth
  resultPane?.classList.add('flash')
  setTimeout(() => writeTarget?.isConnected && writeTarget.classList.remove('active'), 420)
})
