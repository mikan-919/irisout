import { compileProject } from 'irisout'
const result = compileProject(new URL('./page.jsx', import.meta.url).pathname, { target: 'ssr' })
await Bun.write(new URL('./generated.mjs', import.meta.url), result.ssrCode)
const { render } = await import('./generated.mjs')
try {
  console.log(render({ incident: { title: '決済API停止' } }))
} catch (error) {
  console.error(error)
  process.exitCode = 1
}
