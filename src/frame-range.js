export function frameCount(duration, fps) {
  return Math.max(1, Math.ceil(duration * fps - 1e-8));
}

// UI frame numbers are 1-based and inclusive at both ends.
export function frameRange(start, end, duration, fps) {
  const total = frameCount(duration, fps);
  start = Math.min(total, Math.max(1, Math.round(start) || 1));
  end = Math.min(total, Math.max(start, Math.round(end) || start));
  const startTime = (start - 1) / fps;
  const endTime = Math.min(duration, end / fps);
  return { start, end, total, count:end-start+1, startTime, endTime, duration:endTime-startTime };
}
