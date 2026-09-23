// 全ページ共通の見た目と、要素が存在するページだけで動く補助処理を読み込む。
import './home.css'
import './playground.css'
import './examples/index.css'
import './examples/bcf-copy-button.css'
import './examples/task-board.css'
import './examples/morph-bcf.css'
import './line-seed.css'
import './playground-entry.js'

const header = document.querySelector('.reference-header')
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
for (const element of document.querySelectorAll('.reveal')) observer.observe(element)

const copyButton = document.querySelector('.install-copy')
copyButton?.addEventListener('click', async () => {
  await navigator.clipboard.writeText('npm install irisout')
  copyButton.classList.add('is-copied')
  copyButton.setAttribute('aria-label', 'コピーしました')
  setTimeout(() => {
    copyButton.classList.remove('is-copied')
    copyButton.setAttribute('aria-label', 'npm install irisout をコピー')
  }, 1200)
})
