import { clamp } from "./utils.js";
export const MAX_CANVAS_EDGE = 32767;
// Bound the RGBA export surface to 256 MiB; source images use additional memory.
export const MAX_CANVAS_AREA = 67108864;

export function computeBaseComposite(frames, settings, scalePercent) {
  const scaleFactor = scalePercent / 100;
  const gap = settings.gap;
  const orientation = settings.orientation;

  const frameRects = frames.map((frame) => ({
    width: Math.max(1, Math.round(frame.width * scaleFactor)),
    height: Math.max(1, Math.round(frame.height * scaleFactor)),
  }));

  if (!frameRects.length) {
    return {
      width: 0,
      height: 0,
      frameRects: [],
      maxFrameWidth: 0,
      maxFrameHeight: 0,
    };
  }

  const maxFrameWidth = Math.max(...frames.map((frame) => frame.width));
  const maxFrameHeight = Math.max(...frames.map((frame) => frame.height));

  let width = 0;
  let height = 0;

  if (orientation === "horizontal") {
    width = frameRects.reduce((sum, rect) => sum + rect.width, 0) + gap * (frameRects.length - 1);
    height = Math.max(...frameRects.map((rect) => rect.height));
  } else {
    width = Math.max(...frameRects.map((rect) => rect.width));
    height = frameRects.reduce((sum, rect) => sum + rect.height, 0) + gap * (frameRects.length - 1);
  }

  return {
    width: Math.max(1, Math.round(width)),
    height: Math.max(1, Math.round(height)),
    frameRects,
    maxFrameWidth,
    maxFrameHeight,
  };
}

export function isCompositeSafe(width, height) {
  return width <= MAX_CANVAS_EDGE && height <= MAX_CANVAS_EDGE && width * height <= MAX_CANVAS_AREA;
}

export function findBestSafeScale(frames, settings, maxPercent) {
  for (let percent = clamp(Math.floor(maxPercent), 1, 200); percent >= 1; percent -= 1) {
    const result = computeBaseComposite(frames, settings, percent);
    if (isCompositeSafe(result.width, result.height)) {
      return percent;
    }
  }
  return 0;
}

export function buildAnalysis(frames, settings) {
  if (!frames.length) {
    return null;
  }

  const base = computeBaseComposite(frames, settings, settings.scale);
  const orientation = settings.orientation;
  const positions = [];
  let cursor = 0;

  for (let index = 0; index < frames.length; index += 1) {
    const frame = frames[index];
    const rect = base.frameRects[index];
    if (orientation === "horizontal") {
      positions.push({
        frame,
        x: cursor,
        y: Math.floor((base.height - rect.height) / 2),
        width: rect.width,
        height: rect.height,
      });
      cursor += rect.width + settings.gap;
    } else {
      positions.push({
        frame,
        x: Math.floor((base.width - rect.width) / 2),
        y: cursor,
        width: rect.width,
        height: rect.height,
      });
      cursor += rect.height + settings.gap;
    }
  }

  const exceedsLimit = !isCompositeSafe(base.width, base.height);
  const recommendedScale = exceedsLimit ? findBestSafeScale(frames, settings, settings.scale - 1) : settings.scale;

  return {
    orientation,
    width: base.width,
    height: base.height,
    maxFrameWidth: base.maxFrameWidth,
    maxFrameHeight: base.maxFrameHeight,
    positions,
    exceedsLimit,
    recommendedScale,
    duration: frames.length / settings.fps,
  };
}
