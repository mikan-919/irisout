/**
 * @typedef {object} TypedCardProps
 * @property {string} title
 * @property {number} count
 * @property {(event: IrisElementEvent<MouseEvent, HTMLButtonElement>) => void} onOpen
 */

/** @param {TypedCardProps} props */
export function TypedCard({ title, count, onOpen }) {
  render(
    <button type="button" onClick={onOpen}>
      {title}: {count}
    </button>,
  )
}
