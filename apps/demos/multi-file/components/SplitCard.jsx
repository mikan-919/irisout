import { CARD_PREFIX } from '../lib/constants.js'
import { formatTitle } from '../lib/format.js'

/**
 * @typedef {object} SplitCardNote
 * @property {number} id
 * @property {string} title
 * @property {string} summary
 * @property {string[]} tags
 */

/**
 * @typedef {object} SplitCardProps
 * @property {SplitCardNote} note
 * @property {string} heading
 * @property {string} prefix
 * @property {() => void} onRemove
 */

/** @param {SplitCardProps} props */
export default function SplitCard({ note, heading, prefix, onRemove }) {
  const expanded = signal(false)

  render(
    <li key={note.id} class={`note-card ${expanded() ? 'expanded' : ''}`}>
      <h2>{heading}</h2>
      <p class="detail">{expanded() ? `${CARD_PREFIX}: ${note.summary}` : note.summary}</p>
      <p class="prefix">{prefix}</p>
      <p class="formatted">{formatTitle(note)}</p>
      <button class="toggle" onClick={() => expanded(!expanded())}>
        {expanded() ? 'collapse' : 'expand'}
      </button>
      {expanded() && (
        <ul class="tags">
          {note.tags.map((tag) => (
            <li key={tag}>{tag}</li>
          ))}
        </ul>
      )}
      <button class="remove" onClick={onRemove}>
        remove
      </button>
    </li>,
  )
}
