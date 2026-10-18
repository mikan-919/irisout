// 公開版で子ルーターのonError追加と経路検出を比較する。内部原因は確定しない。
import { Hono } from 'hono'
import { createFileRouter } from 'irisout/hono'
import { irisoutHono } from 'irisout/hono/vite'

for (const withOnError of [false, true]) {
  const pages = createFileRouter(new URL('./on-error-pages', import.meta.url).pathname)
  if (withOnError) pages.onError((error, context) => context.text(error.message, 500))
  const app = new Hono()
  app.route('/', pages)
  try {
    irisoutHono(app)
    console.log(JSON.stringify({ withOnError, result: 'accepted' }))
  } catch (error) {
    console.log(JSON.stringify({ withOnError, result: 'rejected', message: error.message }))
  }
}
