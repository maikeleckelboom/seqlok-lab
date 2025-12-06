<script setup lang="ts">
import { ref } from "vue";
import { useHotswapLab } from "./useHotswapLab";
import HotswapConfigPanel from "./HotswapConfigPanel.vue";
import HotswapViewport from "./HotswapViewport.vue";
import HotswapInspector from "./HotswapInspector.vue";
import HotswapStateMachine from "./HotswapStateMachine.vue";

const inspectorOpen = ref(false);

const {
  blockFrames,
  fadeFrames,
  preWarmBlocks,
  frames,
  cursor,
  currentFrame,
  engineGains,
  currentStepKind,
  engineActivity,
  phaseSegments,
  blockTicks,
  majorBlockTicks,
  cursorPct,
  totalBlocks,
  blocksPerSlot,
  estimatedBlocks,
  sumGainPath,
  currentGainPath,
  nextGainPath,
  crossfadeCurveId,
  crossfadeCurves,
  playbackSpeed,
  playbackSpeedOptions,
  isPlaying,
  isLooping,
  generateTrace,
  togglePlayback,
  toggleLoop,
  stepForward,
  stepBackward,
  goToBlock,
  stopPlayback,
} = useHotswapLab();
</script>

<template>
  <div
    class="h-svh flex flex-col bg-zinc-950 text-zinc-100 font-sans antialiased"
  >
    <main
      class="flex-1 overflow-y-auto overflow-x-hidden overscroll-none scrollbar-thin"
    >
      <div class="w-full max-w-7xl mx-auto">
        <!-- Main grid with better balance -->
        <div class="grid gap-6 lg:gap-8 lg:grid-cols-[minmax(0,1fr)_320px]">
          <!-- Left column: Config + Viewport -->
          <div class="flex flex-col gap-6 min-w-0">
            <HotswapConfigPanel
              :block-frames="blockFrames"
              :fade-frames="fadeFrames"
              :pre-warm-blocks="preWarmBlocks"
              :estimated-blocks="estimatedBlocks"
              :crossfade-curve-id="crossfadeCurveId"
              :crossfade-curves="crossfadeCurves"
              :playback-speed="playbackSpeed"
              :playback-speed-options="playbackSpeedOptions"
              @update:block-frames="(value) => (blockFrames = value)"
              @update:fade-frames="(value) => (fadeFrames = value)"
              @update:pre-warm-blocks="(value) => (preWarmBlocks = value)"
              @update:crossfade-curve-id="(value) => (crossfadeCurveId = value)"
              @update:playback-speed="(value) => (playbackSpeed = value)"
              @regenerate="generateTrace"
            />

            <HotswapViewport
              :frames="frames"
              :cursor="cursor"
              :engine-gains="engineGains"
              :phase-segments="phaseSegments"
              :block-ticks="blockTicks"
              :major-block-ticks="majorBlockTicks"
              :cursor-pct="cursorPct"
              :total-blocks="totalBlocks"
              :blocks-per-slot="blocksPerSlot"
              :sum-gain-path="sumGainPath"
              :current-gain-path="currentGainPath"
              :next-gain-path="nextGainPath"
              :is-playing="isPlaying"
              :is-looping="isLooping"
              :on-toggle-playback="togglePlayback"
              :on-toggle-loop="toggleLoop"
              :on-step-forward="stepForward"
              :on-step-backward="stepBackward"
              :on-stop-playback="stopPlayback"
              @update:cursor="goToBlock"
            />
          </div>

          <!-- Right column: Inspector (sticky on desktop) -->
          <div
            class="flex flex-col gap-4 lg:sticky lg:top-6 lg:self-start lg:max-h-[calc(100vh-5rem)] lg:overflow-y-auto no-scrollbar"
          >
            <HotswapInspector
              v-model:open="inspectorOpen"
              :current-frame="currentFrame"
              :current-step-kind="currentStepKind"
              :engine-gains="engineGains"
              :engine-activity="engineActivity"
            />
            <HotswapStateMachine
              :current-phase="currentFrame?.state.phase ?? 'idle'"
              :has-prewarm="preWarmBlocks > 0"
            />
          </div>
        </div>
      </div>
    </main>
  </div>
</template>
