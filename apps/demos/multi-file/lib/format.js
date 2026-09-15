import { CARD_PREFIX } from './constants.js'

export function formatTitle(note) {
  return `${CARD_PREFIX} / ${note.title}`
}

export function matchesFilter(note, filter) {
  return filter === 'all' || note.status === filter
}

export function nextFilter(filter) {
  return filter === 'all' ? 'archived' : 'all'
}
