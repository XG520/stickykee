<template>
  <transition name="hc-modal">
    <div
      v-if="confirmState.open"
      class="fixed inset-0 z-[110] flex items-center justify-center bg-black/40 backdrop-blur-sm px-4"
      @click.self="settleConfirm(false)"
    >
      <div class="w-full max-w-sm rounded-2xl bg-surface border border-border shadow-2xl p-5 space-y-3">
        <h3 class="text-base font-semibold text-on-surface">{{ confirmState.title }}</h3>
        <p class="text-sm text-muted font-body leading-relaxed whitespace-pre-line">{{ confirmState.message }}</p>
        <div class="flex gap-2 pt-1">
          <button
            class="flex-1 h-10 rounded-xl bg-surface-alt border border-border text-muted text-sm font-medium hover:text-on-surface transition-colors"
            @click="settleConfirm(false)"
          >{{ confirmState.cancelText }}</button>
          <button
            class="flex-1 h-10 rounded-xl text-sm font-semibold text-white transition-opacity hover:opacity-90"
            :class="confirmState.danger ? 'bg-error' : 'bg-primary'"
            @click="settleConfirm(true)"
          >{{ confirmState.confirmText }}</button>
        </div>
      </div>
    </div>
  </transition>
</template>

<script setup>
import { confirmState, settleConfirm } from '@/composables/useConfirm'
</script>
