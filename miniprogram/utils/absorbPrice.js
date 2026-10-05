function isAbsorbedPriceTag(tag) {
  if (!tag || tag.type === 'multiple') return false
  const name = String((tag.name || tag.categoryName || '')).trim()
  if (name === '份量') return true
  if (!(tag.source === 'categoryRef' || tag.categoryId)) return false
  return (tag.options || []).some(option => Number(option && option.price) > 0)
}

function getAbsorbedOptionId(option) {
  if (!option) return ''
  if (typeof option === 'string') return option
  return option.id || option.dishId || option._id || option.name || option.dishName || ''
}

function sumAbsorbedExtra(tags = [], selectedTags = {}) {
  let extra = 0
  ;(tags || []).forEach(tag => {
    if (!isAbsorbedPriceTag(tag)) return
    const selectedValue = selectedTags && selectedTags[tag.id]
    const selectedIds = Array.isArray(selectedValue) ? selectedValue : (selectedValue ? [selectedValue] : [])
    selectedIds.forEach(optionId => {
      const option = (tag.options || []).find(opt => getAbsorbedOptionId(opt) === optionId)
      extra += Number(option && option.price) || 0
    })
  })
  return extra
}

module.exports = {
  isAbsorbedPriceTag,
  getAbsorbedOptionId,
  sumAbsorbedExtra
}
