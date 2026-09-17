import { ref, onMounted, onBeforeUnmount } from 'vue'

// 感应式自动隐藏：初始状态由 initVisible 决定（默认显示）；
// 鼠标进入感应区（enter）显示并保持，离开（leave）后开始倒计时隐藏。
// 相比监听全局 mousemove，只有移动到感应区位置才显示。
export function useAutoHide(idleMs = 3000, initVisible = true) {
  const visible = ref(initVisible)
  let timer = null

  function arm() {
    clearTimeout(timer)
    timer = setTimeout(() => { visible.value = false }, idleMs)
  }

  // 鼠标进入感应区：显示并保持（不自动隐藏）
  function enter() {
    visible.value = true
    clearTimeout(timer)
  }

  // 鼠标离开感应区：开始倒计时隐藏
  function leave() { arm() }

  onMounted(() => { visible.value = initVisible })
  onBeforeUnmount(() => clearTimeout(timer))

  return { visible, enter, leave }
}
