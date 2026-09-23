import { JSDOM } from 'jsdom'
import { describe, expect, it } from 'vite-plus/test'
import {
  createRouteDefinition,
  createRouteNavigator,
  createRouteTable,
  type NavigationPageResponse,
} from '../../routes/src/index.ts'

const table = createRouteTable([createRouteDefinition('/'), createRouteDefinition('/users/:id')])

function waitForNavigation(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

describe('client route navigation', () => {
  it('初回hydrate失敗時に同じ文書を再読込しない', async () => {
    const dom = new JSDOM('<!doctype html><div id="app"><p>server</p></div>', {
      url: 'https://example.test/',
    })
    const fallbacks: string[] = []
    const navigator = createRouteNavigator({
      table,
      window: dom.window as unknown as Window,
      document: dom.window.document as unknown as Document,
      container: dom.window.document.querySelector('#app')!,
      hydrateInitial: () => {
        throw new Error('hydrate failed')
      },
      fetchPage: async () => ({ type: 'error', status: 500 }),
      renderPage: async () => undefined,
      fallback: (url) => fallbacks.push(url.href),
    })

    await expect(navigator.start()).rejects.toThrow('hydrate failed')
    expect(fallbacks).toEqual([])
    expect(dom.window.document.querySelector('#app')?.textContent).toBe('server')
  })

  it('初回stateを再取得せず、リンクと履歴で画面を切り替える', async () => {
    const dom = new JSDOM(
      '<!doctype html><a id="fragment" href="#part">part</a><div id="app"><p>server</p><a id="user" href="/users/123?tab=posts">user</a></div>',
      { url: 'https://example.test/' },
    )
    const container = dom.window.document.querySelector('#app')
    if (!container) throw new Error('navigation container was not created')
    const fetched: string[] = []
    const unmounted: string[] = []
    const fallbacks: string[] = []
    const navigator = createRouteNavigator({
      table,
      window: dom.window as unknown as Window,
      document: dom.window.document as unknown as Document,
      container,
      hydrateInitial: (match) => {
        container.setAttribute('data-route', match.route.path)
        return { unmount: () => unmounted.push('initial') }
      },
      fetchPage: async (_url, match) => {
        fetched.push(match.route.path)
        return {
          type: 'page',
          routeId: match.route.id,
          html: `<p>${match.params.id ?? 'home'}</p>`,
          state: { __irisout_state__: true },
        }
      },
      renderPage: async (response: NavigationPageResponse, _match, target) => {
        target.innerHTML = response.html
        return { unmount: () => unmounted.push(response.routeId) }
      },
      fallback: (url) => fallbacks.push(url.href),
    })

    await navigator.start()
    expect(fetched).toEqual([])
    expect(container.getAttribute('data-route')).toBe('/')

    const link = dom.window.document.querySelector('#user')
    if (!link) throw new Error('managed link was not created')
    const click = new dom.window.MouseEvent('click', {
      bubbles: true,
      cancelable: true,
      button: 0,
    })
    link.dispatchEvent(click)
    await waitForNavigation()
    expect(click.defaultPrevented).toBe(true)
    expect(fetched).toEqual(['/users/:id'])
    expect(dom.window.location.href).toBe('https://example.test/users/123?tab=posts')
    expect(container.innerHTML).toContain('>123</p>')
    expect(unmounted).toEqual(['initial'])

    dom.window.history.pushState({}, '', '/users/456?tab=next')
    dom.window.dispatchEvent(new dom.window.PopStateEvent('popstate'))
    await waitForNavigation()
    expect(fetched).toEqual(['/users/:id', '/users/:id'])
    expect(container.innerHTML).toContain('>456</p>')

    expect(await navigator.navigate('/users/456?tab=changed')).toBe(true)
    expect(fetched).toEqual(['/users/:id', '/users/:id', '/users/:id'])
    expect(dom.window.location.search).toBe('?tab=changed')

    const fragment = dom.window.document.querySelector('#fragment')
    if (!fragment) throw new Error('fragment link was not created')
    const fragmentClick = new dom.window.MouseEvent('click', {
      bubbles: true,
      cancelable: true,
      button: 0,
    })
    fragment.dispatchEvent(fragmentClick)
    expect(fragmentClick.defaultPrevented).toBe(false)
    expect(fetched).toHaveLength(3)
    expect(fallbacks).toEqual([])
    navigator.stop()
  })

  it('対象外操作を標準動作へ戻し、最後に開始した応答だけを表示する', async () => {
    const dom = new JSDOM(
      '<!doctype html><div id="app"><a id="external" href="https://other.test/">external</a><a id="download" href="/file" download>download</a><a id="document" href="/users/1" data-irisout-document>document</a><a id="tab" href="/users/1" target="_blank">tab</a><a id="modifier" href="/users/1">modifier</a></div>',
      { url: 'https://example.test/' },
    )
    const container = dom.window.document.querySelector('#app')
    if (!container) throw new Error('navigation container was not created')
    const fallbacks: string[] = []
    const pending = new Map<string, (response: NavigationPageResponse) => void>()
    const navigator = createRouteNavigator({
      table,
      window: dom.window as unknown as Window,
      document: dom.window.document as unknown as Document,
      container,
      fetchPage: (_url, match) => {
        const id = match.params.id ?? 'home'
        if (id === 'failure') return Promise.reject(new Error('network'))
        return new Promise((resolve) => {
          pending.set(id, resolve)
        })
      },
      renderPage: (response, _match, target) => {
        target.innerHTML = response.html
        return { unmount: () => {} }
      },
      fallback: (url) => fallbacks.push(url.href),
    })
    await navigator.start()

    for (const id of ['external', 'download', 'document', 'tab']) {
      const link = dom.window.document.querySelector(`#${id}`)
      if (!link) throw new Error(`${id} link was not created`)
      const event = new dom.window.MouseEvent('click', {
        bubbles: true,
        cancelable: true,
        button: 0,
      })
      link.dispatchEvent(event)
      expect(event.defaultPrevented).toBe(false)
    }
    const modifier = dom.window.document.querySelector('#modifier')
    if (!modifier) throw new Error('modifier link was not created')
    const modifiedClick = new dom.window.MouseEvent('click', {
      bubbles: true,
      cancelable: true,
      button: 0,
      ctrlKey: true,
    })
    modifier.dispatchEvent(modifiedClick)
    expect(modifiedClick.defaultPrevented).toBe(false)

    const slow = navigator.navigate('/users/slow')
    const fast = navigator.navigate('/users/fast')
    pending.get('fast')?.({
      type: 'page',
      routeId: '/users/:id',
      html: '<p>fast</p>',
      state: { __irisout_state__: true },
    })
    expect(await fast).toBe(true)
    pending.get('slow')?.({
      type: 'page',
      routeId: '/users/:id',
      html: '<p>slow</p>',
      state: { __irisout_state__: true },
    })
    expect(await slow).toBe(false)
    expect(container.innerHTML).toBe('<p>fast</p>')
    expect(fallbacks).toEqual([])

    const failed = navigator.navigate('/users/failure')
    expect(await failed).toBe(false)
    expect(fallbacks).toEqual(['https://example.test/users/failure'])
    navigator.stop()
  })
})
