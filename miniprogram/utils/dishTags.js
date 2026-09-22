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

function dishToTagOption(dish, defaultSelected = false) {
  return {
    dishId: dish._id,
    name: dish.name || '',
    price: Number(dish.price) || 0,
    image: dish.image || '',
    defaultSelected: defaultSelected === true
  }
}

function getOptionMatchKey(option) {
  if (!option) return ''
  if (typeof option === 'string') {
    const name = option.trim()
    return name ? `name:${name}` : ''
  }
  const dishId = option.dishId || option._id || ''
  if (dishId) return `dishId:${dishId}`
  const name = (option.name || option.dishName || '').trim()
  return name ? `name:${name}` : ''
}

function buildDefaultKeySet(options = []) {
  const keys = new Set()
  ;(options || []).forEach(option => {
    if (option && option.defaultSelected === true) {
      const key = getOptionMatchKey(option)
      if (key) keys.add(key)
    }
  })
  return keys
}

function isOptionDefault(option, defaultKeys) {
  if (!defaultKeys || defaultKeys.size === 0) return false
  const key = getOptionMatchKey(option)
  return key ? defaultKeys.has(key) : false
}

function expandCategoryRefTag(tag, categoryDishesMap = {}) {
  if (!isCategoryRefTag(tag)) {
    return tag
  }

  const dishes = categoryDishesMap[tag.categoryId] || []
  const defaultKeys = buildDefaultKeySet(tag.options || [])
  const options = dishes.map(dish => {
    const dishOption = {
      dishId: dish._id,
      name: dish.name || ''
    }
    return dishToTagOption(dish, isOptionDefault(dishOption, defaultKeys))
  })

  return {
    ...tag,
    options
  }
}

function applyBatchDefaultToTag(tag, defaultCandidate, clearDefault = false) {
  if (!tag) return tag

  if (isCategoryRefTag(tag)) {
    if (clearDefault) {
      return {
        ...tag,
        options: (tag.options || []).map(option => ({
          ...option,
          defaultSelected: false
        }))
      }
    }

    if (!defaultCandidate) return tag

    return {
      ...tag,
      options: [{
        dishId: defaultCandidate.dishId || '',
        name: defaultCandidate.name || '',
        defaultSelected: true
      }]
    }
  }

  const defaultDishId = defaultCandidate && defaultCandidate.dishId ? defaultCandidate.dishId : ''
  const defaultName = defaultCandidate && defaultCandidate.name ? defaultCandidate.name : ''
  const options = (tag.options || []).map(option => {
    if (typeof option === 'string') {
      const isDefault = !clearDefault && defaultName && option === defaultName
      return {
        name: option,
        price: 0,
        image: '',
        defaultSelected: isDefault
      }
    }

    const dishId = option.dishId || option._id || ''
    const name = option.name || option.dishName || ''
    let isDefault = false

    if (!clearDefault) {
      if (defaultDishId && dishId === defaultDishId) {
        isDefault = true
      } else if (defaultName && name === defaultName) {
        isDefault = true
      }
    }

    return {
      ...option,
      dishId,
      name,
      defaultSelected: isDefault
    }
  })

  if (tag.type === 'single' && !clearDefault) {
    let hasDefault = false
    return {
      ...tag,
      options: options.map(option => {
        if (option.defaultSelected && !hasDefault) {
          hasDefault = true
          return option
        }
        return {
          ...option,
          defaultSelected: false
        }
      })
    }
  }

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

function serializeTagForStorage(tag) {
  if (!tag) return tag

  if (!isCategoryRefTag(tag)) {
    return tag
  }

  const defaultOption = (tag.options || []).find(option => option && option.defaultSelected === true)
  if (!defaultOption) {
    return {
      ...tag,
      options: []
    }
  }

  return {
    ...tag,
    options: [{
      dishId: defaultOption.dishId || defaultOption._id || '',
      name: defaultOption.name || defaultOption.dishName || '',
      defaultSelected: true
    }]
  }
}

function serializeTagsForStorage(tags = []) {
  return (tags || []).map(serializeTagForStorage)
}

module.exports = {
  CATEGORY_REF_SOURCE,
  isCategoryRefTag,
  buildCategoryRefTag,
  dishToTagOption,
  getOptionMatchKey,
  buildDefaultKeySet,
  isOptionDefault,
  expandCategoryRefTag,
  applyBatchDefaultToTag,
  collectCategoryIdsFromTags,
  collectCategoryIdsFromDishes,
  getTagRemoveKey,
  getTagDisplayLabel,
  tagsMatchRemoveKey,
  mergeTagIntoDish,
  removeTagByKey,
  serializeTagForStorage,
  serializeTagsForStorage
}
