<script setup lang="ts">
import { ref, watch } from 'vue'
import { Button } from '@/components/ui/button'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { CATEGORIES, type Category } from '@/lib/catalog'

export type AppDetails = { name: string; description: string; category: Category }

/** `initial` set = dialog open. Collects the name, description and category every app is created with. */
const props = defineProps<{
  initial: AppDetails | null
  title: string
  subtitle: string
  submitLabel: string
  busy?: boolean
  error?: string
}>()
const emit = defineEmits<{ submit: [details: AppDetails]; close: [] }>()

const name = ref('')
const description = ref('')
const category = ref<Category>('other')
watch(() => props.initial, (v) => {
  if (!v) return
  name.value = v.name
  description.value = v.description
  category.value = v.category
}, { immediate: true })

function submit() {
  if (!name.value.trim() || !description.value.trim() || props.busy) return
  emit('submit', { name: name.value.trim(), description: description.value.trim(), category: category.value })
}
</script>

<template>
  <Dialog :open="!!initial" @update:open="(o) => { if (!o) emit('close') }">
    <DialogContent class="sm:max-w-lg">
      <form class="grid gap-4" @submit.prevent="submit">
        <DialogHeader>
          <DialogTitle>{{ title }}</DialogTitle>
          <DialogDescription>{{ subtitle }}</DialogDescription>
        </DialogHeader>

        <div class="grid gap-1.5">
          <Label for="app-name">Name</Label>
          <Input id="app-name" v-model="name" required maxlength="100" placeholder="e.g. Service Bay Planner" />
        </div>
        <div class="grid gap-1.5">
          <Label for="app-desc">Description</Label>
          <Textarea
            id="app-desc"
            v-model="description"
            required
            maxlength="500"
            rows="3"
            class="resize-none"
            placeholder="What does this app help you do? This shows on its card."
          />
          <p class="text-right text-xs text-muted-foreground">{{ description.length }}/500</p>
        </div>
        <fieldset class="grid gap-1.5">
          <legend class="mb-1.5 text-sm font-medium">Category</legend>
          <div class="flex flex-wrap gap-1.5">
            <Button
              v-for="c in CATEGORIES"
              :key="c.key"
              type="button"
              size="sm"
              :variant="category === c.key ? 'default' : 'outline'"
              :aria-pressed="category === c.key"
              @click="category = c.key"
            >
              <component :is="c.icon" class="size-3.5" />{{ c.label }}
            </Button>
          </div>
        </fieldset>

        <p v-if="error" class="text-[13px] text-destructive">{{ error }}</p>
        <DialogFooter>
          <Button type="button" variant="ghost" @click="emit('close')">Cancel</Button>
          <Button type="submit" :disabled="busy || !name.trim() || !description.trim()">{{ busy ? 'Please wait…' : submitLabel }}</Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>
</template>
