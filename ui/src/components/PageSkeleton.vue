<template>
  <div class="page-skeleton" role="status" aria-busy="true">
    <var-skeleton v-for="index in 4" :key="index" :rows="2" />
  </div>
</template>
