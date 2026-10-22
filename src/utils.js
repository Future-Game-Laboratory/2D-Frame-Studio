export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function formatNumber(value) {
  return new Intl.NumberFormat("en-US").format(value);
}

export function formatDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return "--";
  }

  if (seconds < 60) {
    return seconds.toFixed(seconds >= 10 ? 1 : 2) + "s";
  }

  const minutes = Math.floor(seconds / 60);
  const remain = seconds - minutes * 60;
  return minutes + "m " + remain.toFixed(remain >= 10 ? 0 : 1) + "s";
}

export function formatFrameStamp(index, total) {
  return "第 " + formatNumber(index + 1) + " / " + formatNumber(total) + " 帧";
}

export function fitContain(width, height, maxWidth, maxHeight) {
  if (width <= 0 || height <= 0) {
    return { width: 1, height: 1, scale: 1 };
  }

  const scale = Math.min(maxWidth / width, maxHeight / height, 1);
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
    scale,
  };
}
