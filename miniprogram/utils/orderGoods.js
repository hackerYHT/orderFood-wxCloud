const { formatTagLabelSuffix } = require('./price.js')

const PACKAGING_FEE = 1
const TABLE_OPTIONS = ['A1', 'A2', 'A3', 'A4', 'A5', 'A6']
const TABLE_PICKER_OPTIONS = ['不选', ...TABLE_OPTIONS]

function calcItemSubtotal(item) {
  const price = Number(item.price) || 0
  const count = Number(item.count) || 0
  return (price * count).toFixed(2)
}

function normalizeGoodsList(goods) {
  return (goods || []).map(item => {
    const price = Number(item.price) || 0
    const count = Number(item.count) || 1
    return {
      ...item,
      dishId: item.dishId || item.goodsId || '',
      dishName: item.dishName || item.goodsName || '未知菜品',
      count,
      price,
      basePrice: item.basePrice != null ? Number(item.basePrice) : price,
      extraPrice: Number(item.extraPrice) || 0,
      tags: item.tags || [],
      subtotal: calcItemSubtotal({ price, count })
    }
  })
}

function calcOrderPrices(goods, orderType) {
  const list = normalizeGoodsList(goods)
  const totalPrice = list.reduce((sum, item) => sum + item.price * item.count, 0)
  const packagingFee = orderType === 'takeOut' ? PACKAGING_FEE : 0
  const finalPrice = totalPrice + packagingFee
  return { totalPrice, packagingFee, finalPrice }
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

function cartToOrderGoods(cart) {
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
      subtotal: (unitPrice * item.count).toFixed(2)
    })
  }
  return goodsList
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
        price: item.basePrice != null ? item.basePrice : item.price
      },
      count: item.count,
      tags: {},
      tagLabels: item.tags || [],
      selectedOptions: item.selectedOptions || [],
      unitPrice: item.price,
      basePrice: item.basePrice != null ? item.basePrice : item.price,
      extraPrice: item.extraPrice || 0,
      dishId: item.dishId
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
  calcOrderPrices,
  cartToOrderGoods,
  orderGoodsToCart,
  resolveTablePickerIndex
}
