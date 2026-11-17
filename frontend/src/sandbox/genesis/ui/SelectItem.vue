<script setup>
import { SelectItem, SelectItemIndicator, SelectItemText } from "reka-ui";
</script>

<template>
<SelectItem class="menu-item select-item">
  <SelectItemIndicator class="select-item-check"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" aria-hidden="true"><path d="M20 6 9 17l-5-5" /></svg></SelectItemIndicator>
  <SelectItemText><slot /></SelectItemText>
</SelectItem>
</template>
