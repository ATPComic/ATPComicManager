<script setup>
defineProps({
  path: { type: String, required: true },
  size: { type: [Number, String], default: 20 }
});
</script>

<template>
  <svg
    class="mdi-icon"
    :width="size"
    :height="size"
    viewBox="0 0 24 24"
    aria-hidden="true"
    focusable="false"
  >
    <path :d="path" />
  </svg>
</template>

<style scoped>
.mdi-icon {
  display: block;
  flex: 0 0 auto;
  fill: currentColor;
}
</style>
