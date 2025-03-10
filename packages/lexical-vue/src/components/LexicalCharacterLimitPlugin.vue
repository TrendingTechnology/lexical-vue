<script setup lang="ts">
import { computed, ref } from 'vue'
import { useEditor } from '../composables/useEditor'
import { useCharacterLimit } from '../composables/useCharacterLimit'

const editor = useEditor()

const CHARACTER_LIMIT = 5

let textEncoderInstance: TextEncoder
function textEncoder(): null | TextEncoder {
  if (window.TextEncoder === undefined)
    return null

  if (!textEncoderInstance)
    textEncoderInstance = new window.TextEncoder()

  return textEncoderInstance
}

const remainingCharacters = ref(0)
const setRemainingCharacters = (payload: number) => {
  remainingCharacters.value = payload
}

const props = withDefaults(defineProps<{
  charset?: 'UTF-8' | 'UTF-16'
}>(), {
  charset: 'UTF-16',
})

function utf8Length(text: string) {
  const currentTextEncoder = textEncoder()
  if (currentTextEncoder === null) {
    // http://stackoverflow.com/a/5515960/210370
    const m = encodeURIComponent(text).match(/%[89ABab]/g)
    return text.length + (m ? m.length : 0)
  }
  return currentTextEncoder.encode(text).length
}

const characterLimitProps = computed(
  () => ({
    remainingCharacters: setRemainingCharacters,
    strlen: (text: string) => {
      if (props.charset === 'UTF-8')
        return utf8Length(text)

      else if (props.charset === 'UTF-16')
        return text.length

      else
        throw new Error('Unrecognized charset')
    },
  }),
)

useCharacterLimit(editor, CHARACTER_LIMIT, characterLimitProps.value)
</script>

<template>
  <span
    :class="`characters-limit ${
      remainingCharacters < 0 ? 'characters-limit-exceeded' : ''
    }`"
  >
    {{ remainingCharacters }}
  </span>
</template>
