// 全ページ共通の見た目と、要素が存在するページだけで動く補助処理を読み込む。
import './home.css'
import './playground.css'
import './examples/index.css'
import './examples/bcf-copy-button.css'
import './examples/task-board.css'
import './examples/morph-bcf.css'
import './line-seed.css'
import './playground-entry.js'

const header = document.querySelector('.reference-site #siteHeader')
if (header) {
  const updateHeader = () => header.classList.toggle('is-scrolled', window.scrollY > 8)
  window.addEventListener('scroll', updateHeader, { passive: true })
  updateHeader()
}

const observer = new IntersectionObserver(
  (entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue
      entry.target.classList.add('on')
      observer.unobserve(entry.target)
    }
  },
  { threshold: 0.12, rootMargin: '0px 0px -12% 0px' },
)
document.querySelectorAll('.reference-site .reveal').forEach((element, index) => {
  if (element.getBoundingClientRect().top < innerHeight * 0.94) {
    setTimeout(() => element.classList.add('on'), 140 + (index % 3) * 70)
  } else {
    observer.observe(element)
  }
})

const copyButton = document.querySelector('.reference-site #copy')
let copyResetTimer
copyButton?.addEventListener('click', async () => {
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
    copyButton.classList.remove('is-copied')
    copyButton.setAttribute('aria-label', 'npm install irisout をコピー')
  }, 1200)
})

const resultPane = document.querySelector('.reference-site #resultPane')
const writeTarget = document.querySelector('.reference-site #writeTarget')
for (const button of document.querySelectorAll('.reference-site #plus, .reference-site #minus')) {
  button.addEventListener('click', () => {
    writeTarget?.classList.add('active')
    resultPane?.classList.remove('flash')
    if (resultPane) void resultPane.offsetWidth
    resultPane?.classList.add('flash')
    setTimeout(() => writeTarget?.classList.remove('active'), 420)
  })
}
