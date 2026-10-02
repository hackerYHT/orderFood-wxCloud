const { formatTagLabelSuffix } = require('./price.js')

const PACKAGING_FEE = 1
const TABLE_OPTIONS = ['A1', 'A2', 'A3', 'A4', 'A5', 'A6']
const TABLE_PICKER_OPTIONS = ['不选', ...TABLE_OPTIONS]

function calcItemSubtotal(item) {
  const price = Number(item.price) || 0
  const count = Number(item.count) || 0
  return (price * count).toFixed(2)
}

function getPackagingFeeCategoryIds(categories) {
  const ids = new Set()
  ;(categories || []).forEach(cat => {
    if (cat && cat.packagingFee === true && cat._id) {
      ids.add(cat._id)
    }
  })
  return ids
}

function isPackagingFeeCategory(categoryId, packagingFeeCategories) {
  if (!categoryId) return false
  const categoryIds = packagingFeeCategories instanceof Set
    ? packagingFeeCategories
    : getPackagingFeeCategoryIds(packagingFeeCategories)
  return categoryIds.has(categoryId)
}

function normalizeGoodsList(goods, packagingFeeCategories) {
  const categoryIds = packagingFeeCategories != null
    ? (packagingFeeCategories instanceof Set
      ? packagingFeeCategories
      : getPackagingFeeCategoryIds(packagingFeeCategories))
    : null

  return (goods || []).map(item => {
    const price = Number(item.price) || 0
    const count = Number(item.count) || 1
    const packagingFeeEligible = categoryIds
      ? !!(item.categoryId && categoryIds.has(item.categoryId))
      : item.packagingFeeEligible === true
    const needPackaging = packagingFeeEligible && item.needPackaging === true
    return {
      ...item,
      dishId: item.dishId || item.goodsId || '',
      dishName: item.dishName || item.goodsName || '未知菜品',
      count,
      price,
      basePrice: item.basePrice != null ? Number(item.basePrice) : price,
      extraPrice: Number(item.extraPrice) || 0,
      tags: item.tags || [],
      packagingFeeEligible,
      needPackaging,
      subtotal: calcItemSubtotal({ price, count })
    }
  })
}

function countPackagingFeeItems(goods, packagingFeeCategories) {
  let itemCount = 0
  normalizeGoodsList(goods, packagingFeeCategories).forEach(item => {
    if (item.needPackaging) {
      itemCount += Number(item.count) || 0
    }
  })
  return itemCount
}

function calcPackagingFee(goods, orderType, packagingFeeCategories) {
  // orderType 仅作兼容保留；打包费按菜品 needPackaging 勾选计费
  const packagingFeeItemCount = countPackagingFeeItems(goods, packagingFeeCategories)
  return {
    packagingFee: packagingFeeItemCount * PACKAGING_FEE,
    packagingFeeItemCount
  }
}

function calcOrderPrices(goods, orderType, packagingFeeCategories) {
  const list = normalizeGoodsList(goods, packagingFeeCategories)
  const totalPrice = list.reduce((sum, item) => sum + item.price * item.count, 0)
  const { packagingFee, packagingFeeItemCount } = calcPackagingFee(list, orderType, packagingFeeCategories)
  const finalPrice = totalPrice + packagingFee
  return { totalPrice, packagingFee, packagingFeeItemCount, finalPrice, goods: list }
}

/**
 * 按整单类型快捷勾选：打包=勾选全部可收打包费菜品；堂食=全部取消
 */
function applyOrderTypePackagingDefaults(goods, orderType, packagingFeeCategories) {
  const list = normalizeGoodsList(goods, packagingFeeCategories)
  const takeOut = orderType === 'takeOut'
  return list.map(item => ({
    ...item,
    needPackaging: takeOut && item.packagingFeeEligible === true
  }))
}

/**
 * 历史订单兼容：无 needPackaging 字段时，整单打包则默认勾选可收打包费菜品
 */
function migrateNeedPackagingFromOrderType(goods, orderType, packagingFeeCategories) {
  const list = normalizeGoodsList(goods, packagingFeeCategories)
  const hasExplicit = (goods || []).some(item => item && typeof item.needPackaging === 'boolean')
  if (hasExplicit) {
    return list
  }
  if (orderType === 'takeOut') {
    return applyOrderTypePackagingDefaults(list, 'takeOut', packagingFeeCategories)
  }
  return list
}

function buildTagsArrayFromCartItem(item) {
  let tagsArray = []
  const dishTags = item.info && item.info.tags
  const selectedTags = item.tags

  if (dishTags && selectedTags && typeof selectedTags === 'object' && !Array.isArray(selectedTags)) {
    dishTags.forEach(tag => {
      const selectedValue = selectedTags[tag.id]
      if (!selectedValue) return
      const selectedIds = Array.isArray(selectedValue) ? selectedValue : [selectedValue]
      const countMap = {}
      selectedIds.forEach(optionId => {
        countMap[optionId] = (countMap[optionId] || 0) + 1
      })
      Object.keys(countMap).forEach(optionId => {
        const count = countMap[optionId]
        const option = (tag.options || []).find(opt => {
          const id = opt.id || opt.name
          return id === optionId
        })
        if (option) {
          const name = option.name || option
          const countText = count > 1 ? ` x${count}` : ''
          const totalExtra = (Number(option.price) || 0) * count
          tagsArray.push(`${tag.name}: ${name}${countText}${formatTagLabelSuffix(totalExtra)}`)
        }
      })
    })
  } else if (item.tagLabels && Array.isArray(item.tagLabels)) {
    tagsArray = item.tagLabels
  } else if (item.tags && Array.isArray(item.tags)) {
    tagsArray = item.tags
  }

  return tagsArray
}

function cartToOrderGoods(cart, packagingFeeCategories) {
  const goodsList = []
  for (let cartKey in cart) {
    const item = cart[cartKey]
    if (!item || !item.info || !item.count) continue

    const unitPrice = Number(item.unitPrice) || Number(item.info.price) || 0
    goodsList.push({
      dishId: item.dishId || item.info._id,
      dishName: item.info.name,
      categoryId: item.info.categoryId || '',
      categoryName: item.info.categoryName || '',
      dishImage: item.info.imageUrl || item.info.image || '',
      price: unitPrice,
      basePrice: Number(item.basePrice) || Number(item.info.price) || 0,
      extraPrice: Number(item.extraPrice) || 0,
      count: item.count,
      tags: buildTagsArrayFromCartItem(item),
      selectedOptions: item.selectedOptions || [],
      needPackaging: item.needPackaging === true,
      selectedTags: JSON.parse(JSON.stringify(item.tags || {})),
      subtotal: (unitPrice * item.count).toFixed(2)
    })
  }
  return normalizeGoodsList(goodsList, packagingFeeCategories)
}

function orderGoodsToCart(goods) {
  const cart = {}
  ;(goods || []).forEach((item, index) => {
    const cartKey = `edit_${item.dishId || 'item'}_${index}`
    cart[cartKey] = {
      info: {
        _id: item.dishId,
        name: item.dishName,
        image: item.dishImage,
        price: item.basePrice != null ? item.basePrice : item.price,
        categoryId: item.categoryId || '',
        categoryName: item.categoryName || ''
      },
      count: item.count,
      tags: item.selectedTags && typeof item.selectedTags === 'object'
        ? JSON.parse(JSON.stringify(item.selectedTags))
        : {},
      tagLabels: item.tags || [],
      selectedOptions: item.selectedOptions || [],
      unitPrice: item.price,
      basePrice: item.basePrice != null ? item.basePrice : item.price,
      extraPrice: item.extraPrice || 0,
      dishId: item.dishId,
      needPackaging: item.needPackaging === true
    }
  })
  return cart
}

function resolveTablePickerIndex(tableNumber) {
  const raw = (tableNumber || '').trim()
  const table = TABLE_OPTIONS.includes(raw) ? raw : ''
  const index = table ? TABLE_PICKER_OPTIONS.indexOf(table) : 0
  return {
    tableNumber: table,
    tablePickerIndex: index >= 0 ? index : 0
  }
}

module.exports = {
  PACKAGING_FEE,
  TABLE_OPTIONS,
  TABLE_PICKER_OPTIONS,
  calcItemSubtotal,
  normalizeGoodsList,
  getPackagingFeeCategoryIds,
  isPackagingFeeCategory,
  countPackagingFeeItems,
  calcPackagingFee,
  calcOrderPrices,
  applyOrderTypePackagingDefaults,
  migrateNeedPackagingFromOrderType,
  cartToOrderGoods,
  orderGoodsToCart,
  resolveTablePickerIndex
}
