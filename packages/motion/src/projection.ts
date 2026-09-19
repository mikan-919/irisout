// irisoutの同期DOM更新をMotionの配置投影木へ接続する。
// 測定・親子補正・共有要素・拡縮補正・割り込みはMotion本体へ委譲する。

import {
  frameData,
  frameSteps,
  handOffElementState,
  hasTransform,
  HTMLProjectionNode,
  HTMLVisualElement,
  time,
  visualElementStore,
} from 'motion'
import type { IProjectionNode, ProjectionNodeOptions, Transition } from 'motion'
import { observeDomUpdates } from '../../runtime/src/index.js'

export type ProjectionLayout = boolean | 'position' | 'size' | 'preserve-aspect'
type ProjectionNode = IProjectionNode<HTMLElement>

export interface ProjectionOptions {
  layout?: ProjectionLayout
  layoutId?: string
  layoutScroll?: boolean
  layoutRoot?: boolean
  layoutCrossfade?: boolean
  transition?: Record<string, unknown>
}

interface ProjectionEntry {
  element: HTMLElement
  node?: ProjectionNode
  options: ProjectionOptions
  restoreParent: Node | null
  restoreNext: ChildNode | null
  removing: boolean
  addedThisUpdate: boolean
}

const entries = new Map<HTMLElement, ProjectionEntry>()
let observing = false

function flushMotionFrame(): void {
  if (frameData.isProcessing) return
  const now = time.now()
  frameData.delta = Math.min(1000 / 60, Math.max(0, now - frameData.timestamp))
  frameData.timestamp = now
  frameData.isProcessing = true
  frameSteps.update.process(frameData)
  frameSteps.preRender.process(frameData)
  frameSteps.render.process(frameData)
  frameData.isProcessing = false
}

function createVisualElement(): HTMLVisualElement {
  return new HTMLVisualElement(
    {
      props: {},
      presenceContext: null,
      visualState: {
        latestValues: {},
        renderState: { transform: {}, transformOrigin: {}, style: {}, vars: {} },
      },
    },
    { allowProjection: true },
  )
}

function projectionParent(element: HTMLElement): IProjectionNode | undefined {
  let parent = element.parentElement
  while (parent) {
    const entry = entries.get(parent)
    if (entry?.node?.instance) return entry.node as unknown as IProjectionNode
    parent = parent.parentElement
  }
  return undefined
}

function nodeOptions(
  entry: ProjectionEntry,
  visualElement: HTMLVisualElement,
): ProjectionNodeOptions {
  const { options } = entry
  return {
    layoutId: options.layoutId,
    layout: options.layout ?? Boolean(options.layoutId),
    animationType: typeof options.layout === 'string' ? options.layout : 'both',
    transition: options.transition as Transition | undefined,
    crossfade: options.layoutCrossfade ?? true,
    layoutScroll: options.layoutScroll,
    layoutRoot: options.layoutRoot,
    visualElement,
  }
}

function prepareEntry(entry: ProjectionEntry): void {
  const { element } = entry
  const storedVisualElement = visualElementStore.get(element)
  const visualElement =
    storedVisualElement instanceof HTMLVisualElement ? storedVisualElement : createVisualElement()
  if (!(storedVisualElement instanceof HTMLVisualElement)) {
    handOffElementState(element, visualElement)
  }
  if (element.style.transform && !hasTransform(visualElement.latestValues)) {
    element.style.transform = ''
  }
  const node = new HTMLProjectionNode(
    visualElement.latestValues,
    projectionParent(element),
  ) as unknown as ProjectionNode
  visualElement.projection = node
  node.setOptions(nodeOptions(entry, visualElement))
  node.mount(element)
  node.isPresent = true
  entry.node = node
}

function dropEntry(entry: ProjectionEntry): void {
  if (!entry.node) {
    entries.delete(entry.element)
    return
  }
  const stack = entry.node.getStack()
  if (!stack || entry.node.isLead()) entry.node.currentAnimation?.stop()
  entry.node.setOptions({ onExitComplete: undefined })
  entry.node.unmount()
  entries.delete(entry.element)
}

function prepareConnectedEntries(addedThisUpdate: boolean): void {
  const pending = [...entries.values()]
    .filter((entry) => !entry.node && !entry.removing && entry.element.isConnected)
    .sort((left, right) => (left.element.compareDocumentPosition(right.element) & 4 ? -1 : 1))
  for (const entry of pending) {
    prepareEntry(entry)
    entry.addedThisUpdate = addedThisUpdate
  }
}

function beforeDomUpdate(): void {
  flushMotionFrame()
  prepareConnectedEntries(false)
  for (const entry of entries.values()) {
    if (!entry.node || !entry.element.isConnected || entry.removing) continue
    entry.restoreParent = entry.element.parentNode
    entry.restoreNext = entry.element.nextSibling
    entry.node.isLayoutDirty = false
    entry.node.willUpdate()
  }
}

function afterDomUpdate(): void {
  prepareConnectedEntries(true)
  let root: IProjectionNode | undefined
  const addedLayoutIds = new Set<string>()
  for (const entry of entries.values()) {
    if (!entry.node) continue
    root ??= entry.node.root
    if (!entry.removing && entry.options.layoutId && entry.addedThisUpdate) {
      addedLayoutIds.add(entry.options.layoutId)
    }
  }

  for (const entry of entries.values()) {
    if (!entry.removing && entry.element.isConnected) continue
    if (!entry.node) {
      entries.delete(entry.element)
      continue
    }
    const { node, element, options } = entry
    const stack = node.getStack()
    const hasSurvivor = stack?.members.some(
      (member) =>
        member !== node &&
        member.instance instanceof element.ownerDocument.defaultView!.Element &&
        member.instance.isConnected,
    )
    if (
      options.layoutId &&
      node.isLead() &&
      hasSurvivor &&
      !addedLayoutIds.has(options.layoutId) &&
      entry.restoreParent?.isConnected
    ) {
      entry.restoreParent.insertBefore(
        element,
        entry.restoreNext?.parentNode === entry.restoreParent ? entry.restoreNext : null,
      )
      node.isPresent = false
      node.setOptions({
        onExitComplete: () => {
          element.remove()
          dropEntry(entry)
        },
      })
      if (node.relegate()) continue
      element.remove()
    }
    dropEntry(entry)
  }
  root?.didUpdate()
  for (const entry of entries.values()) entry.addedThisUpdate = false
}

function ensureObserver(): void {
  if (observing) return
  observing = true
  observeDomUpdates({ before: beforeDomUpdate, after: afterDomUpdate })
}

export function registerProjectionElement(
  element: Element,
  options: ProjectionOptions,
): () => void {
  const HtmlElement = element.ownerDocument.defaultView?.HTMLElement
  if (!HtmlElement || !(element instanceof HtmlElement)) {
    throw new Error('motion: layout and layoutId support HTML elements only')
  }
  ensureObserver()
  const existing = entries.get(element)
  const entry = existing ?? {
    element: element as HTMLElement,
    options,
    restoreParent: element.parentNode,
    restoreNext: element.nextSibling,
    removing: false,
    addedThisUpdate: false,
  }
  entries.set(element as HTMLElement, entry)
  entry.options = options
  entry.removing = false
  if (entry.node) entry.node.isPresent = true
  const visualElement = visualElementStore.get(element)
  if (visualElement instanceof HTMLVisualElement) {
    entry.node?.setOptions(nodeOptions(entry, visualElement))
  }
  return () => {
    entry.removing = true
    if (entry.node) entry.node.isPresent = false
  }
}
