<template>
  <div class="page-skeleton" role="status" aria-busy="true">
    <var-skeleton v-for="index in 4" :key="index" :rows="2" />
  </div>
</template>

<style>
.page-skeleton { padding: 16px; display: grid; gap: 20px; align-content: start; overflow: auto; }
.page-skeleton .var-skeleton { min-height: 48px; }
</style>
