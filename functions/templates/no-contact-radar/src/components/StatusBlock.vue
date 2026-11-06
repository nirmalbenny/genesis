<script setup>
defineProps({
  kind: { type: String, required: true }, // loading | error | empty
  title: { type: String, default: "" },
  message: { type: String, default: "" },
});
defineEmits(["retry"]);
</script>

<template>
  <div class="status" :class="kind" role="status">
    <div v-if="kind === 'loading'" class="spinner" aria-hidden="true"></div>
    <p v-if="title" class="title">{{ title }}</p>
    <p v-if="message" class="msg">{{ message }}</p>
    <button v-if="kind === 'error'" class="btn" type="button" @click="$emit('retry')">
      Retry
    </button>
  </div>
</template>

<style scoped>
.status {
  background: #fff;
  border: 1px solid #dfe3eb;
  border-radius: 10px;
  padding: 32px 20px;
  text-align: center;
}
.title {
  margin: 0 0 6px;
  font-weight: 600;
  color: #213343;
}
.msg {
  margin: 0;
  color: #516f90;
  overflow-wrap: anywhere;
}
.error .title {
  color: #c0392b;
}
.btn {
  margin-top: 16px;
  background: #ff5c35;
  color: #fff;
  border: 0;
  border-radius: 8px;
  padding: 9px 18px;
  font: inherit;
  font-weight: 600;
  cursor: pointer;
}
.btn:hover {
  background: #e84e29;
}
.spinner {
  width: 26px;
  height: 26px;
  margin: 0 auto 12px;
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
</style>
