// 公式js-framework-benchmarkのキー付き一覧。DOM操作はirisoutの生成コードへ委ねる。
import { render, signal } from 'irisout'

const adjectives = [
  'pretty',
  'large',
  'big',
  'small',
  'tall',
  'short',
  'long',
  'handsome',
  'plain',
  'quaint',
  'clean',
  'elegant',
  'easy',
  'angry',
  'crazy',
  'helpful',
  'mushy',
  'odd',
  'unsightly',
  'adorable',
  'important',
  'inexpensive',
  'cheap',
  'expensive',
  'fancy',
]
const colors = [
  'red',
  'yellow',
  'blue',
  'green',
  'pink',
  'brown',
  'purple',
  'brown',
  'white',
  'black',
  'orange',
]
const nouns = [
  'table',
  'chair',
  'house',
  'bbq',
  'desk',
  'car',
  'pony',
  'cookie',
  'sandwich',
  'burger',
  'pizza',
  'mouse',
  'keyboard',
]
const idCounter = { value: 1 }

function random(max) {
  return Math.round(Math.random() * 1000) % max
}

function buildData(count) {
  const data = []
  for (let i = 0; i < count; i++) {
    data.push({
      id: idCounter.value++,
      label:
        adjectives[random(adjectives.length)] +
        ' ' +
        colors[random(colors.length)] +
        ' ' +
        nouns[random(nouns.length)],
    })
  }
  return data
}

export function Benchmark() {
  const rows = signal([])
  const selected = signal(0)

  render(
    <div class="container">
      <div class="jumbotron">
        <div class="row">
          <div class="col-md-6">
            <h1>irisout</h1>
          </div>
          <div class="col-md-6">
            <div class="row">
              <div class="col-sm-6 smallpad">
                <button type="button" class="btn btn-primary btn-block" id="run" onClick={run}>
                  Create 1,000 rows
                </button>
              </div>
              <div class="col-sm-6 smallpad">
                <button
                  type="button"
                  class="btn btn-primary btn-block"
                  id="runlots"
                  onClick={runLots}
                >
                  Create 10,000 rows
                </button>
              </div>
              <div class="col-sm-6 smallpad">
                <button type="button" class="btn btn-primary btn-block" id="add" onClick={add}>
                  Append 1,000 rows
                </button>
              </div>
              <div class="col-sm-6 smallpad">
                <button
                  type="button"
                  class="btn btn-primary btn-block"
                  id="update"
                  onClick={update}
                >
                  Update every 10th row
                </button>
              </div>
              <div class="col-sm-6 smallpad">
                <button type="button" class="btn btn-primary btn-block" id="clear" onClick={clear}>
                  Clear
                </button>
              </div>
              <div class="col-sm-6 smallpad">
                <button
                  type="button"
                  class="btn btn-primary btn-block"
                  id="swaprows"
                  onClick={swapRows}
                >
                  Swap Rows
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
      <table class="table table-hover table-striped test-data">
        <tbody>
          {rows().map((row) => (
            <tr key={row.id} class={selected() === row.id ? 'danger' : ''}>
              <td class="col-md-1">{row.id}</td>
              <td class="col-md-4">
                <a onClick={() => selected(row.id)}>{row.label}</a>
              </td>
              <td class="col-md-1">
                <a onClick={() => rows(rows().filter((item) => item.id !== row.id))}>
                  <span class="glyphicon glyphicon-remove" aria-hidden="true" />
                </a>
              </td>
              <td class="col-md-6" />
            </tr>
          ))}
        </tbody>
      </table>
      <span class="preloadicon glyphicon glyphicon-remove" aria-hidden="true" />
    </div>,
  )

  function run() {
    rows(buildData(1000))
    selected(0)
  }
  function runLots() {
    rows(buildData(10000))
    selected(0)
  }
  function add() {
    rows([...rows(), ...buildData(1000)])
  }
  function update() {
    rows(
      rows().map((row, index) => (index % 10 === 0 ? { ...row, label: row.label + ' !!!' } : row)),
    )
  }
  function clear() {
    rows([])
    selected(0)
  }
  function swapRows() {
    if (rows().length > 998) {
      const data = rows().slice()
      const row = data[1]
      data[1] = data[998]
      data[998] = row
      rows(data)
    }
  }
}
