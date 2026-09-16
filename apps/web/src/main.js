// ホームページの生成HTMLに、画面内へ入った要素だけの表示を接続する。
// IntersectionObserverがない環境では初期HTMLをそのまま表示する。
import './styles.css'
import 'virtual:irisout-entry'

if ('IntersectionObserver' in window) {
  document.documentElement.classList.add('is-enhanced')
  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return
      entry.target.classList.add('is-in')
      observer.unobserve(entry.target)
    })
  })
  document.querySelectorAll('[data-reveal]').forEach((element) => observer.observe(element))
}
