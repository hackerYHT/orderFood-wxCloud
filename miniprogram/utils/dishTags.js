const CATEGORY_REF_SOURCE = 'categoryRef'

function isCategoryRefTag(tag) {
  if (!tag) return false
  return tag.source === CATEGORY_REF_SOURCE || !!tag.categoryId
}

function buildCategoryRefTag({ categoryId, categoryName, name, type = 'single', required = true }) {
  const label = (name || categoryName || '').trim()
  return {
    id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    name: label,
    type: type === 'multiple' ? 'multiple' : 'single',
    required: required !== false,
    source: CATEGORY_REF_SOURCE,
    categoryId,
    categoryName: categoryName || label,
    options: []
  }
}

function dishToTagOption(dish) {
  return {
    dishId: dish._id,
    name: dish.name || '',
    price: Number(dish.price) || 0,
    image: dish.image || '',
    defaultSelected: false
  }
}

function expandCategoryRefTag(tag, categoryDishesMap = {}) {
  if (!isCategoryRefTag(tag)) {
    return tag
  }

  const dishes = categoryDishesMap[tag.categoryId] || []
  const options = dishes.map(dish => dishToTagOption(dish))

  return {
    ...tag,
    options
  }
}

function collectCategoryIdsFromTags(tags = []) {
  const categoryIds = new Set()
  tags.forEach(tag => {
    if (isCategoryRefTag(tag) && tag.categoryId) {
      categoryIds.add(tag.categoryId)
    }
  })
  return [...categoryIds]
}

function collectCategoryIdsFromDishes(dishes = []) {
  const categoryIds = new Set()
  dishes.forEach(dish => {
    collectCategoryIdsFromTags(dish.tags || []).forEach(id => categoryIds.add(id))
  })
  return [...categoryIds]
}

function getTagRemoveKey(tag) {
  if (!tag) return ''
  if (isCategoryRefTag(tag)) {
    return `categoryRef:${tag.categoryId || tag.name || ''}`
  }
  return `name:${(tag.name || '').trim()}`
}

function getTagDisplayLabel(tag) {
  if (!tag) return ''
  if (isCategoryRefTag(tag)) {
    const name = tag.name || tag.categoryName || '分类标签'
    return `${name}（分类动态）`
  }
  return tag.name || ''
}

function tagsMatchRemoveKey(tag, removeKey) {
  return getTagRemoveKey(tag) === removeKey
}

function mergeTagIntoDish(tags = [], newTag) {
  const nextTags = [...tags]
  const removeKey = getTagRemoveKey(newTag)
  const existingIndex = nextTags.findIndex(tag => tagsMatchRemoveKey(tag, removeKey))

  if (existingIndex > -1) {
    nextTags[existingIndex] = {
      ...nextTags[existingIndex],
      ...newTag,
      id: nextTags[existingIndex].id || newTag.id
    }
  } else {
    nextTags.push(newTag)
  }

  return nextTags
}

function removeTagByKey(tags = [], removeKey) {
  return tags.filter(tag => !tagsMatchRemoveKey(tag, removeKey))
}

module.exports = {
  CATEGORY_REF_SOURCE,
  isCategoryRefTag,
  buildCategoryRefTag,
  dishToTagOption,
  expandCategoryRefTag,
  collectCategoryIdsFromTags,
  collectCategoryIdsFromDishes,
  getTagRemoveKey,
  getTagDisplayLabel,
  tagsMatchRemoveKey,
  mergeTagIntoDish,
  removeTagByKey
}
