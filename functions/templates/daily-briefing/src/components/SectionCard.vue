<script setup>
defineProps({
  title: { type: String, required: true },
  loading: { type: Boolean, default: false },
  error: { type: String, default: "" },
  empty: { type: Boolean, default: false },
  emptyText: { type: String, default: "Nothing to show." },
  emptyIcon: { type: String, default: "✨" },
  badge: { type: [Number, String], default: null },
});
defineEmits(["retry"]);
</script>

<template>
  <section class="card">
    <header class="head">
      <h2>{{ title }}</h2>
      <span v-if="badge !== null && badge !== undefined && !loading && !error" class="badge">{{ badge }}</span>
    </header>

    <div v-if="loading" class="loading" aria-busy="true">
      <div class="skeleton" v-for="n in 3" :key="n"></div>
      <span class="sr">Loading…</span>
    </div>

    <div v-else-if="error" class="state error" role="alert">
      <p class="msg">{{ error }}</p>
      <button type="button" class="retry" @click="$emit('retry')">Retry</button>
    </div>

    <div v-else-if="empty" class="state">
      <div class="icon">{{ emptyIcon }}</div>
      <p class="empty-text">{{ emptyText }}</p>
    </div>

    <div v-else class="body">
      <slot />
    </div>
  </section>
</template>

<style scoped>
.card {
  background: #fff;
  border: 1px solid #dfe3eb;
  border-radius: 10px;
  padding: 20px;
  min-width: 0;
}
.head {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 14px;
}
h2 {
  margin: 0;
  font-size: 17px;
  color: #213343;
}
.badge {
  background: #fff1ed;
  color: #ff5c35;
  font-size: 12px;
  font-weight: 700;
  border-radius: 999px;
  padding: 2px 10px;
}
.loading {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.skeleton {
  height: 46px;
  border-radius: 8px;
  background: linear-gradient(90deg, #eef1f5 25%, #f7f9fb 50%, #eef1f5 75%);
  background-size: 200% 100%;
  animation: shimmer 1.2s infinite linear;
}
@keyframes shimmer {
  from {
    background-position: 200% 0;
  }
  to {
    background-position: -200% 0;
  }
}
.sr {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
}
.state {
  text-align: center;
  padding: 24px 8px;
  color: #516f90;
}
.icon {
  font-size: 28px;
  margin-bottom: 6px;
}
.empty-text {
  margin: 0;
  font-size: 14px;
}
.state.error {
  background: #fff6f4;
  border: 1px solid #ffd3c8;
  border-radius: 8px;
}
.msg {
  margin: 0 0 12px;
  color: #b3361a;
  font-size: 14px;
  word-break: break-word;
}
.retry {
  background: #ff5c35;
  color: #fff;
  border: 1px solid #ff5c35;
  border-radius: 8px;
  padding: 8px 16px;
  font: inherit;
  font-weight: 600;
  cursor: pointer;
}
.retry:hover {
  background: #e84e29;
}
</style>