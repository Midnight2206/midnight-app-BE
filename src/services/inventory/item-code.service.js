export function buildAutoItemCode(itemId) {
  return `QT${String(itemId).padStart(6, "0")}`;
}

