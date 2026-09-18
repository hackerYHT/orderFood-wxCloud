/**
 * 价格格式化工具（JS）
 */

function normalizePrice(price) {
  const num = Number(price)
  if (isNaN(num) || num <= 0) return 0
  return num
}

function formatPrice(price) {
  const num = normalizePrice(price)
  return num > 0 ? num.toFixed(2) : ''
}

function formatTagOptionPrice(price) {
  const formatted = formatPrice(price)
  return formatted ? `+${formatted}元` : ''
}

function formatTagLabelSuffix(price) {
  const formatted = formatPrice(price)
  return formatted ? ` +${formatted}元` : ''
}

module.exports = {
  normalizePrice,
  formatPrice,
  formatTagOptionPrice,
  formatTagLabelSuffix
}
