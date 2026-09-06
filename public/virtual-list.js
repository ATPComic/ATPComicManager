export function getVirtualWindow(totalItems, scrollTop, viewportHeight, rowHeight, buffer = 5) {
  const safeRowHeight = Math.max(1, Number(rowHeight) || 1);
  const total = Math.max(0, Number(totalItems) || 0);
  const visibleCount = Math.ceil(Math.max(0, Number(viewportHeight) || 0) / safeRowHeight);
  const start = Math.max(0, Math.floor(Math.max(0, Number(scrollTop) || 0) / safeRowHeight) - buffer);
  const end = Math.min(total, start + visibleCount + buffer * 2);
  return {
    start,
    end,
    topHeight: start * safeRowHeight,
    bottomHeight: (total - end) * safeRowHeight
  };
}
