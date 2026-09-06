import { TypedCard } from './typed-card.jsx'

/**
 * @typedef {object} LocalCardProps
 * @property {string} label
 * @property {() => void} onSelect
 */

/** @param {LocalCardProps} props */
function LocalCard({ label, onSelect }) {
  render(<button onClick={onSelect}>{label}</button>)
}

render(<LocalCard label="local" onSelect={() => {}} />)
render(<TypedCard title="imported" count={1} onOpen={() => {}} />)

// @ts-expect-error 必須プロパティonSelectの欠落を検出する。
render(<LocalCard label="missing" />)

// @ts-expect-error 宣言にないプロパティを検出する。
render(<LocalCard label="extra" onSelect={() => {}} typo />)

// @ts-expect-error 相対import先の必須プロパティcountの欠落を検出する。
render(<TypedCard title="missing" onOpen={() => {}} />)

// @ts-expect-error 相対import先のプロパティ値型の不一致を検出する。
render(<TypedCard title="wrong" count="1" onOpen={() => {}} />)

render(
  <input
    onKeyDown={(event) => {
      String(event.key)
      String(event.currentTarget.value)
      // @ts-expect-error KeyboardEventにclientXは存在しない。
      Number(event.clientX)
      // @ts-expect-error targetは入力要素へ絞らずDOM標準型を維持する。
      String(event.target.value)
    }}
    onInput={(event) => event.data}
    onChange={(event) => event.type}
    onBlur={(event) => event.relatedTarget}
  />,
)

render(
  <button
    onClick={(event) => {
      Number(event.clientX)
      Boolean(event.currentTarget.disabled)
      // @ts-expect-error MouseEventにkeyは存在しない。
      String(event.key)
    }}
    onDblClick={(event) => event.clientY}
  />,
)

render(<div onCustomEvent={() => {}} />)

// @ts-expect-error 任意のonXxx属性も関数以外を拒否する。
render(<div onCustomEvent="not a function" />)
