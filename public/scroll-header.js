export function scrollHeaderState(previous, top, max = Infinity) {
  if (previous.hidden && previous.top > max && top >= max - 1) {
    return { top, max, hidden: true, travel: 0 };
  }
  const delta = top - previous.top;
  if (top <= 12) return { top, max, hidden: false, travel: 0 };
  const travel = Math.sign(delta) === Math.sign(previous.travel) ? previous.travel + delta : delta;
  return { top, max, travel, hidden: Math.abs(travel) >= 24 ? travel > 0 : previous.hidden };
}
