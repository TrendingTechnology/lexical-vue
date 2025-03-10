import type { ElementNode, GridSelection, LexicalEditor, LexicalNode, RangeSelection } from 'lexical'

import {
  $createOverflowNode,
  $isOverflowNode,
  OverflowNode,
} from '@lexical/overflow'
import { $rootTextContentCurry } from '@lexical/text'
import { $dfs, mergeRegister } from '@lexical/utils'
import {
  $getSelection,
  $isLeafNode,
  $isRangeSelection,
  $isTextNode,
  $setSelection,
} from 'lexical'
import { onMounted, onUnmounted } from 'vue'

interface OptionalProps {
  remainingCharacters?: (characters: number) => void
  strlen?: (input: string) => number
}

export function useCharacterLimit(
  editor: LexicalEditor,
  maxCharacters: number,
  optional: OptionalProps = Object.freeze({}),
): void {
  const {
    strlen = input => input.length, // UTF-16
    remainingCharacters = (_characters) => {},
  } = optional
  let unregisterListener: () => void

  onMounted(() => {
    if (!editor.hasNodes([OverflowNode])) {
      throw new Error(
        'useCharacterLimit: OverflowNode not registered on editor',
      )
    }
  })

  onMounted(() => {
    let text = editor.getEditorState().read($rootTextContentCurry)
    let lastComputedTextLength = 0

    unregisterListener = mergeRegister(
      editor.registerTextContentListener((currentText: string) => {
        text = currentText
      }),
      editor.registerUpdateListener(({ dirtyLeaves }) => {
        const isComposing = editor.isComposing()
        const hasDirtyLeaves = dirtyLeaves.size > 0
        if (isComposing || !hasDirtyLeaves)
          return

        const textLength = strlen(text)
        const textLengthAboveThreshold
          = textLength > maxCharacters
          || (lastComputedTextLength !== null
            && lastComputedTextLength > maxCharacters)
        const diff = maxCharacters - textLength
        remainingCharacters(diff)
        if (lastComputedTextLength === null || textLengthAboveThreshold) {
          const offset = findOffset(text, maxCharacters, strlen)
          editor.update(
            () => {
              $wrapOverflowedNodes(offset)
            },
            {
              tag: 'history-merge',
            },
          )
        }
        lastComputedTextLength = textLength
      }),
    )
  })

  onUnmounted(() => {
    unregisterListener?.()
  })
}

function findOffset(
  text: string,
  maxCharacters: number,
  strlen: (input: string) => number,
): number {
  // @ts-expect-error: TODO: https://github.com/microsoft/TypeScript/issues/48523
  const Segmenter = Intl.Segmenter
  let offsetUtf16 = 0
  let offset = 0
  if (typeof Segmenter === 'function') {
    const segmenter = new Segmenter()
    const graphemes = segmenter.segment(text)
    for (const { segment: grapheme } of graphemes) {
      const nextOffset = offset + strlen(grapheme)
      if (nextOffset > maxCharacters)
        break

      offset = nextOffset
      offsetUtf16 += grapheme.length
    }
  }
  else {
    const codepoints = Array.from(text)
    const codepointsLength = codepoints.length
    for (let i = 0; i < codepointsLength; i++) {
      const codepoint = codepoints[i]
      const nextOffset = offset + strlen(codepoint)
      if (nextOffset > maxCharacters)
        break

      offset = nextOffset
      offsetUtf16 += codepoint.length
    }
  }
  return offsetUtf16
}

function $wrapOverflowedNodes(offset: number): void {
  const dfsNodes = $dfs()
  const dfsNodesLength = dfsNodes.length
  let accumulatedLength = 0
  for (let i = 0; i < dfsNodesLength; i += 1) {
    const { node } = dfsNodes[i]
    if ($isOverflowNode(node)) {
      const previousLength = accumulatedLength
      const nextLength = accumulatedLength + node.getTextContentSize()
      if (nextLength <= offset) {
        const parent = node.getParent()
        const previousSibling = node.getPreviousSibling()
        const nextSibling = node.getNextSibling()
        $unwrapNode(node)
        const selection = $getSelection() as RangeSelection | GridSelection
        // Restore selection when the overflow children are removed
        if (
          $isRangeSelection(selection)
          && (!selection.anchor.getNode().isAttached()
            || !selection.focus.getNode().isAttached())
        ) {
          if ($isTextNode(previousSibling))
            previousSibling.select()

          else if ($isTextNode(nextSibling))
            nextSibling.select()

          else if (parent !== null)
            parent.select()
        }
      }
      else if (previousLength < offset) {
        const descendant = node.getFirstDescendant()
        const descendantLength
          = descendant !== null ? descendant.getTextContentSize() : 0
        const previousPlusDescendantLength = previousLength + descendantLength
        // For simple text we can redimension the overflow into a smaller and more accurate
        // container
        const firstDescendantIsSimpleText
          = $isTextNode(descendant) && descendant.isSimpleText()
        const firstDescendantDoesNotOverflow
          = previousPlusDescendantLength <= offset
        if (firstDescendantIsSimpleText || firstDescendantDoesNotOverflow)
          $unwrapNode(node)
      }
    }
    else if ($isLeafNode(node)) {
      const previousAccumulatedLength = accumulatedLength
      accumulatedLength += node.getTextContentSize()
      if (accumulatedLength > offset && !$isOverflowNode(node.getParent())) {
        const previousSelection = $getSelection()
        let overflowNode
        // For simple text we can improve the limit accuracy by splitting the TextNode
        // on the split point
        if (
          previousAccumulatedLength < offset
          && $isTextNode(node)
          && node.isSimpleText()
        ) {
          const [, overflowedText] = node.splitText(
            offset - previousAccumulatedLength,
          )
          overflowNode = $wrapNode(overflowedText)
        }
        else {
          overflowNode = $wrapNode(node)
        }
        if (previousSelection !== null)
          $setSelection(previousSelection)

        mergePrevious(overflowNode)
      }
    }
  }
}

function $wrapNode(node: LexicalNode): OverflowNode {
  const overflowNode = $createOverflowNode()
  node.insertBefore(overflowNode)
  overflowNode.append(node)
  return overflowNode
}

function $unwrapNode(node: OverflowNode): LexicalNode | null {
  const children = node.getChildren()
  const childrenLength = children.length
  for (let i = 0; i < childrenLength; i++)
    node.insertBefore(children[i])

  node.remove()
  return childrenLength > 0 ? children[childrenLength - 1] : null
}

export function mergePrevious(overflowNode: OverflowNode): void {
  const previousNode = overflowNode.getPreviousSibling()
  if (!$isOverflowNode(previousNode))
    return

  const firstChild = overflowNode.getFirstChild()
  const previousNodeChildren = (previousNode as ElementNode).getChildren()
  const previousNodeChildrenLength = previousNodeChildren.length
  if (firstChild === null) {
    overflowNode.append(...previousNodeChildren)
  }
  else {
    for (let i = 0; i < previousNodeChildrenLength; i++)
      firstChild.insertBefore(previousNodeChildren[i])
  }

  const selection = $getSelection() as RangeSelection | GridSelection
  if ($isRangeSelection(selection)) {
    const anchor = selection.anchor
    const anchorNode = anchor.getNode()
    const focus = selection.focus
    const focusNode = anchor.getNode()
    if (anchorNode.is(previousNode)) {
      anchor.set(overflowNode.getKey(), anchor.offset, 'element')
    }
    else if (anchorNode.is(overflowNode)) {
      anchor.set(
        overflowNode.getKey(),
        previousNodeChildrenLength + anchor.offset,
        'element',
      )
    }
    if (focusNode.is(previousNode)) {
      focus.set(overflowNode.getKey(), focus.offset, 'element')
    }
    else if (focusNode.is(overflowNode)) {
      focus.set(
        overflowNode.getKey(),
        previousNodeChildrenLength + focus.offset,
        'element',
      )
    }
  }

  previousNode?.remove()
}
