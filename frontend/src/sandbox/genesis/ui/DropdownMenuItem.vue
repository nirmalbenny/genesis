<script setup>
import { DropdownMenuItem } from "reka-ui";
defineProps({ variant: { type: String, default: "default" } }); // default | destructive
</script>

<template>
<DropdownMenuItem :class="['menu-item', variant === 'destructive' && 'danger']"><slot /></DropdownMenuItem>
</template>
