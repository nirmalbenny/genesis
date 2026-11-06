<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import AppDetailsDialog, { type AppDetails } from '@/components/AppDetailsDialog.vue'
import { api } from '@/lib/api'
import type { Category } from '@/lib/catalog'

/** `source` set = dialog open. Copies the app server-side and opens the copy in the editor. */
const props = defineProps<{ source: { id: string; name: string; description: string; category: Category } | null }>()
const emit = defineEmits<{ close: [] }>()
const router = useRouter()

const busy = ref(false)
const error = ref('')
const initial = computed<AppDetails | null>(() =>
  props.source ? { name: `${props.source.name} copy`, description: props.source.description, category: props.source.category } : null,
)

async function copy(details: AppDetails) {
  if (!props.source) return
  busy.value = true
  error.value = ''
  try {
    const { id } = await api<{ id: string }>('POST', `/projects/${props.source.id}/duplicate`, details)
    emit('close')
    await router.push(`/p/${id}`)
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <AppDetailsDialog
    :initial="initial"
    :title="`Make a copy of “${source?.name}”`"
    subtitle="The copy is yours to edit. The original stays exactly as it is."
    submit-label="Make a copy"
    :busy="busy"
    :error="error"
    @submit="copy"
    @close="error = ''; emit('close')"
  />
</template>
