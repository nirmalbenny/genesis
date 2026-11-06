import { ref } from "vue";

// Small loader with loading / error state; ignores stale responses.
export function useResource(fetcher) {
  const data = ref(null);
  const loading = ref(true);
  const error = ref("");
  let seq = 0;

  async function load() {
    const id = ++seq;
    loading.value = true;
    error.value = "";
    try {
      const result = await fetcher();
      if (id !== seq) return;
      data.value = result;
    } catch (e) {
      if (id !== seq) return;
      data.value = null;
      error.value = (e && e.message) || "Something went wrong.";
    } finally {
      if (id === seq) loading.value = false;
    }
  }

  return { data, loading, error, load };
}