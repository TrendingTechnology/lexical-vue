<script setup lang="ts">
import type { LinkMatcher } from '../composables/useAutoLink'
import { useAutoLink } from '../composables/useAutoLink'
import { useEditor } from '../composables/useEditor'
const editor = useEditor()

const props = defineProps<{
  matchers: LinkMatcher[]
}>()

const emit = defineEmits<{
  (e: 'change', value: { url: string | null; prevUrl: string | null }): void
}>()

useAutoLink(editor, props.matchers, (url: string | null, prevUrl: string | null) => {
  emit('change', {
    url,
    prevUrl,
  })
})
</script>

<template />
