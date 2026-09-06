<template>
  <div class="page-skeleton" role="status" aria-busy="true">
    <var-skeleton v-for="index in 6" :key="index" title avatar :rows="3" />
  </div>
</template>
