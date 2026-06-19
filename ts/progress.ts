let currentPercent = 0;
let targetPercent = 0;
let animationFrameId: number | null = null;
let isFinished = false;
const updateBarDOM = (percent: number) => {
  const bar = document.getElementById("progress-bar");
  if (bar) {
    bar.style.width = `${percent}%`;
  }
};
const tick = () => {
  if (isFinished) {
    if (currentPercent < 100) {
      currentPercent += (100 - currentPercent) * 0.15 + 0.4;
      if (currentPercent >= 100) {
        currentPercent = 100;
        updateBarDOM(100);
        setTimeout(() => {
          const overlay = document.getElementById("loading-overlay");
          if (overlay) {
            overlay.classList.remove("show");
          }
          setTimeout(() => {
            currentPercent = 0;
            updateBarDOM(0);
          }, 400);
        }, 250);
        animationFrameId = null;
        return;
      }
      updateBarDOM(currentPercent);
      animationFrameId = requestAnimationFrame(tick);
    }
    return;
  }
  const diff = targetPercent - currentPercent;
  if (diff > 0.1) {
    currentPercent += diff * 0.06;
  } else {
    if (currentPercent < 98) {
      const trickleVelocity = currentPercent < 75 ? 0.045 : 0.012;
      currentPercent += (98 - currentPercent) * 0.001 + trickleVelocity;
    }
  }
  updateBarDOM(currentPercent);
  animationFrameId = requestAnimationFrame(tick);
};
export const updateProgress = (percentage: number, statusText: string, subtext: string = "") => {
  const overlay = document.getElementById("loading-overlay");
  const status = document.getElementById("loading-status");
  const sub = document.getElementById("loading-subtext");
  if (overlay) overlay.classList.add("show");
  if (status) status.textContent = statusText;
  if (sub) sub.textContent = subtext;
  targetPercent = Math.min(99, Math.max(0, percentage));
  isFinished = false;
  if (animationFrameId === null) {
    if (currentPercent >= 100) {
      currentPercent = 0;
      updateBarDOM(0);
    }
    animationFrameId = requestAnimationFrame(tick);
  }
};
export const hideProgress = () => {
  isFinished = true;
  if (animationFrameId === null) {
    animationFrameId = requestAnimationFrame(tick);
  }
};
