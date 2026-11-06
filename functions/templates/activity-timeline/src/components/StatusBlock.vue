<script setup>
defineProps({
  state: { type: String, required: true }, // loading | error | empty
  message: { type: String, default: "" },
  title: { type: String, default: "" },
});
const emit = defineEmits(["retry"]);
</script>

<template>
  <div class="status" :class="state" role="status">
    <template v-if="state === 'loading'">
      <span class="spinner" aria-hidden="true"></span>
      <p>{{ message || "Loading…" }}</p>
    </template>
    <template v-else-if="state === 'error'">
      <p class="title">{{ title || "Something went wrong" }}</p>
      <p class="msg">{{ message || "Unknown error" }}</p>
      <button class="btn" type="button" @click="emit('retry')">Retry</button>
    </template>
    <template v-else>
      <p class="title">{{ title }}</p>
      <p class="msg">{{ message }}</p>
    </template>
  </div>
</template>

<style scoped>
.status {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 28px 16px;
  text-align: center;
  color: #516f90;
}
.status p {
  margin: 0;
}
.title {
  color: #213343;
  font-weight: 600;
}
.msg {
  font-size: 14px;
  overflow-wrap: anywhere;
}
.error .msg {
  color: #b4351a;
}
.spinner {
  width: 22px;
  height: 22px;
  border: 3px solid #dfe3eb;
  border-top-color: #ff5c35;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
.btn {
  margin-top: 4px;
  background: #ff5c35;
  color: #fff;
  border: 0;
  border-radius: 8px;
  padding: 8px 18px;
  font: inherit;
  font-weight: 600;
  cursor: pointer;
}
.btn:hover {
  background: #e84f2b;
}
</style>