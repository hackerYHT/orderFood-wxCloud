/**
 * 订单菜品规格编辑混入（确认打印 / 编辑订单共用）
 * 使用方式：Page({ ...dishSpecEditor, ... })
 * 页面需提供 applyGoodsUpdate(goods) 以回写列表并重算价格
 */
const db = wx.cloud.database()
const { formatTagLabelSuffix } = require('./price.js')
const {
  expandCategoryRefTag,
  collectCategoryIdsFromDishes
} = require('./dishTags.js')

const dishSpecEditor = {
  initDishSpecEditor() {
    this.dishById = this.dishById || {}
    this.categoryDishesMap = this.categoryDishesMap || {}
  },

  stopPropagation() {},

  getGoodsById(dishId) {
    if (!dishId) return null
    return (this.dishById && this.dishById[dishId]) || null
  },

  async loadCategoryDishesMap(categoryIds = []) {
    const uniqueIds = [...new Set((categoryIds || []).filter(Boolean))]
    if (!uniqueIds.length) {
      return this.categoryDishesMap || {}
    }

    const nextMap = { ...(this.categoryDishesMap || {}) }
    await Promise.all(uniqueIds.map(async categoryId => {
      const pageSize = 20
      let page = 0
      let dishes = []
      let hasMore = true

      while (hasMore) {
        const res = await db.collection('dish')
          .where({ categoryId })
          .orderBy('sort', 'asc')
          .skip(page * pageSize)
          .limit(pageSize)
          .get()
        const list = (res.data || []).filter(item => item.status === 1 && item.deleted !== true)
        dishes = dishes.concat(list)
        hasMore = list.length === pageSize
        page += 1
      }

      nextMap[categoryId] = dishes
      dishes.forEach(item => {
        this.dishById[item._id] = item
      })
    }))

    this.categoryDishesMap = nextMap
    return nextMap
  },

  async ensureDishLookup(dish) {
    const categoryIds = collectCategoryIdsFromDishes([dish])
    const categoryDishesMap = categoryIds.length
      ? await this.loadCategoryDishesMap(categoryIds)
      : (this.categoryDishesMap || {})

    const expandedDish = this.normalizeDishTags(dish, categoryDishesMap)
    const missingIdSet = new Set()
    ;(expandedDish.tags || []).forEach(tag => {
      ;(tag.options || []).forEach(option => {
        if (typeof option !== 'object') return
        const dishId = option.dishId || option._id || ''
        if (dishId && !this.getGoodsById(dishId)) {
          missingIdSet.add(dishId)
        }
      })
    })

    const missingIds = [...missingIdSet]
    if (!missingIds.length) return

    const res = await db.collection('dish').where({
      _id: db.command.in(missingIds)
    }).get()

    ;(res.data || []).forEach(item => {
      this.dishById[item._id] = item
    })
  },

  normalizeTagOption(option) {
    if (typeof option === 'string') {
      return {
        id: option,
        name: option,
        price: 0,
        image: '',
        defaultSelected: false
      }
    }

    const dishId = option.dishId || option._id || ''
    const id = option.id || dishId || option.name || option.dishName
    const refDish = dishId ? this.getGoodsById(dishId) : null
    return {
      ...option,
      id,
      dishId,
      name: refDish ? refDish.name : (option.name || option.dishName || ''),
      price: refDish ? (Number(refDish.price) || 0) : (Number(option.price) || 0),
      image: refDish ? (refDish.image || '') : (option.image || option.dishImage || ''),
      defaultSelected: option.defaultSelected === true
    }
  },

  normalizeDishTags(dish, categoryDishesMap = this.categoryDishesMap || {}) {
    const normalizedDish = JSON.parse(JSON.stringify(dish || {}))
    normalizedDish.tags = (normalizedDish.tags || []).map(tag => {
      const expandedTag = expandCategoryRefTag(tag, categoryDishesMap)
      return {
        ...expandedTag,
        type: expandedTag.type || 'single',
        options: (expandedTag.options || []).map(option => this.normalizeTagOption(option))
      }
    })
    return this.updateTagOptionSelectedState(normalizedDish, {})
  },

  buildDefaultSelectedTags(dish) {
    const selectedTags = {}
    const tags = (dish && dish.tags) || []

    tags.forEach(tag => {
      const defaultOptions = (tag.options || [])
        .map(option => this.normalizeTagOption(option))
        .filter(option => option.defaultSelected)

      if (tag.type === 'multiple') {
        selectedTags[tag.id] = defaultOptions.map(option => option.id)
      } else if (defaultOptions.length > 0) {
        selectedTags[tag.id] = defaultOptions[0].id
      }
    })

    return selectedTags
  },

  getTagOptionCount(selectedValue, optionId) {
    if (!selectedValue || !optionId) return 0
    if (Array.isArray(selectedValue)) {
      return selectedValue.filter(id => id === optionId).length
    }
    return selectedValue === optionId ? 1 : 0
  },

  updateTagOptionSelectedState(dish, selectedTags) {
    const nextDish = JSON.parse(JSON.stringify(dish || {}))
    nextDish.tags = (nextDish.tags || []).map(tag => ({
      ...tag,
      options: (tag.options || []).map(option => {
        const normalizedOption = this.normalizeTagOption(option)
        const selectedValue = selectedTags[tag.id]
        const selectedCount = this.getTagOptionCount(selectedValue, normalizedOption.id)
        return {
          ...normalizedOption,
          selected: selectedCount > 0,
          selectedCount
        }
      })
    }))
    return nextDish
  },

  getSelectedOptionList(dish, selectedTags) {
    const selectedOptions = []
    const tags = (dish && dish.tags) || []

    tags.forEach(tag => {
      const selectedValue = selectedTags[tag.id]
      const selectedIds = Array.isArray(selectedValue) ? selectedValue : (selectedValue ? [selectedValue] : [])
      selectedIds.forEach(optionId => {
        const option = (tag.options || []).map(item => this.normalizeTagOption(item)).find(item => item.id === optionId)
        if (option) {
          selectedOptions.push(option)
        }
      })
    })

    return selectedOptions
  },

  buildTagLabels(dish, selectedTags) {
    const labels = []
    const tags = (dish && dish.tags) || []

    tags.forEach(tag => {
      const selectedValue = selectedTags[tag.id]
      const selectedIds = Array.isArray(selectedValue) ? selectedValue : (selectedValue ? [selectedValue] : [])
      const countMap = {}
      selectedIds.forEach(optionId => {
        countMap[optionId] = (countMap[optionId] || 0) + 1
      })
      Object.keys(countMap).forEach(optionId => {
        const count = countMap[optionId]
        const option = (tag.options || []).map(item => this.normalizeTagOption(item)).find(item => item.id === optionId)
        if (option) {
          const countText = count > 1 ? ` x${count}` : ''
          const totalExtra = (Number(option.price) || 0) * count
          labels.push(`${tag.name}: ${option.name}${countText}${formatTagLabelSuffix(totalExtra)}`)
        }
      })
    })

    return labels
  },

  calculateUnitPrice(dish, selectedTags) {
    const basePrice = Number(dish && dish.price) || 0
    const extraPrice = this.getSelectedOptionList(dish, selectedTags)
      .reduce((sum, option) => sum + (Number(option.price) || 0), 0)
    return basePrice + extraPrice
  },

  calculateModalTotalPrice(dish, selectedTags, count) {
    return (this.calculateUnitPrice(dish, selectedTags) * count).toFixed(2)
  },

  updateModalPriceAndOptions(selectedTags) {
    const currentDish = this.updateTagOptionSelectedState(this.data.currentDish, selectedTags)
    this.setData({
      currentDish,
      selectedTags,
      modalTotalPrice: this.calculateModalTotalPrice(currentDish, selectedTags, this.data.modalDishCount)
    })
  },

  async openEditGoods(e) {
    const index = Number(e.currentTarget.dataset.index)
    const item = this.data.orderGoods[index]
    if (!item || !item.dishId) return

    this.initDishSpecEditor()
    wx.showLoading({ title: '加载中...' })
    try {
      let rawGoods = this.getGoodsById(item.dishId)
      if (!rawGoods) {
        const res = await db.collection('dish').doc(item.dishId).get()
        if (res.data && res.data.deleted !== true) {
          rawGoods = res.data
          this.dishById[item.dishId] = rawGoods
        }
      }
      if (!rawGoods) {
        wx.showToast({ title: '菜品不存在', icon: 'none' })
        return
      }

      await this.ensureDishLookup(rawGoods)
      const categoryIds = collectCategoryIdsFromDishes([rawGoods])
      const categoryDishesMap = categoryIds.length
        ? await this.loadCategoryDishesMap(categoryIds)
        : (this.categoryDishesMap || {})
      const goods = this.normalizeDishTags(rawGoods, categoryDishesMap)

      let selectedTags = JSON.parse(JSON.stringify(item.selectedTags || {}))
      if (!selectedTags || Object.keys(selectedTags).length === 0) {
        selectedTags = this.buildDefaultSelectedTags(goods)
      }

      const currentDish = this.updateTagOptionSelectedState(goods, selectedTags)
      const modalDishCount = Math.max(1, Number(item.count) || 1)

      this.setData({
        showTagModal: true,
        editIndex: index,
        currentDish,
        selectedTags,
        modalDishCount,
        modalTotalPrice: this.calculateModalTotalPrice(currentDish, selectedTags, modalDishCount)
      })
    } catch (err) {
      console.error('打开规格编辑失败', err)
      wx.showToast({ title: '加载失败', icon: 'none' })
    } finally {
      wx.hideLoading()
    }
  },

  closeTagModal() {
    this.setData({
      showTagModal: false,
      editIndex: -1,
      currentDish: null,
      selectedTags: {},
      modalDishCount: 1,
      modalTotalPrice: '0.00'
    })
  },

  selectTagOption(e) {
    const { tagId, optionId } = e.currentTarget.dataset
    const selectedTags = { ...this.data.selectedTags }
    const tag = (this.data.currentDish.tags || []).find(item => item.id === tagId)

    if (selectedTags[tagId] === optionId && tag && !tag.required) {
      delete selectedTags[tagId]
    } else {
      selectedTags[tagId] = optionId
    }

    this.updateModalPriceAndOptions(selectedTags)
  },

  toggleTagOption(e) {
    const { tagId, optionId } = e.currentTarget.dataset
    if (!tagId || !optionId) return

    const selectedTags = JSON.parse(JSON.stringify(this.data.selectedTags || {}))
    if (!selectedTags[tagId]) {
      selectedTags[tagId] = []
    } else if (!Array.isArray(selectedTags[tagId])) {
      selectedTags[tagId] = [selectedTags[tagId]]
    }
    selectedTags[tagId] = [...selectedTags[tagId], optionId]
    this.updateModalPriceAndOptions(selectedTags)
  },

  reduceTagOption(e) {
    const { tagId, optionId } = e.currentTarget.dataset
    if (!tagId || !optionId) return

    const selectedTags = JSON.parse(JSON.stringify(this.data.selectedTags || {}))
    const tagArray = Array.isArray(selectedTags[tagId])
      ? [...selectedTags[tagId]]
      : (selectedTags[tagId] ? [selectedTags[tagId]] : [])
    const idx = tagArray.lastIndexOf(optionId)
    if (idx > -1) {
      tagArray.splice(idx, 1)
    }
    if (tagArray.length === 0) {
      delete selectedTags[tagId]
    } else {
      selectedTags[tagId] = tagArray
    }
    this.updateModalPriceAndOptions(selectedTags)
  },

  increaseModalCount() {
    const newCount = this.data.modalDishCount + 1
    this.setData({
      modalDishCount: newCount,
      modalTotalPrice: this.calculateModalTotalPrice(this.data.currentDish, this.data.selectedTags, newCount)
    })
  },

  decreaseModalCount() {
    if (this.data.modalDishCount <= 1) return
    const newCount = this.data.modalDishCount - 1
    this.setData({
      modalDishCount: newCount,
      modalTotalPrice: this.calculateModalTotalPrice(this.data.currentDish, this.data.selectedTags, newCount)
    })
  },

  confirmEditGoods() {
    const { currentDish, selectedTags, modalDishCount, editIndex, orderGoods } = this.data
    if (editIndex < 0 || !currentDish || !orderGoods[editIndex]) {
      this.closeTagModal()
      return
    }

    if (currentDish.tags && currentDish.tags.length > 0) {
      for (let tag of currentDish.tags) {
        if (tag.required) {
          const selectedValue = selectedTags[tag.id]
          if (!selectedValue || (Array.isArray(selectedValue) && selectedValue.length === 0)) {
            wx.showToast({ title: `请选择${tag.name}`, icon: 'none' })
            return
          }
        }
      }
    }

    const selectedOptions = this.getSelectedOptionList(currentDish, selectedTags)
    const tagLabels = this.buildTagLabels(currentDish, selectedTags)
    const unitPrice = this.calculateUnitPrice(currentDish, selectedTags)
    const basePrice = Number(currentDish.price) || 0
    const count = Math.max(1, Number(modalDishCount) || 1)
    const prev = orderGoods[editIndex]

    const goods = [...orderGoods]
    goods[editIndex] = {
      ...prev,
      dishId: currentDish._id,
      dishName: currentDish.name,
      categoryId: currentDish.categoryId || prev.categoryId || '',
      categoryName: currentDish.categoryName || prev.categoryName || '',
      dishImage: currentDish.imageUrl || currentDish.image || prev.dishImage || '',
      price: unitPrice,
      basePrice,
      extraPrice: unitPrice - basePrice,
      count,
      tags: tagLabels,
      selectedTags: JSON.parse(JSON.stringify(selectedTags)),
      selectedOptions,
      subtotal: (unitPrice * count).toFixed(2)
    }

    this.closeTagModal()
    if (typeof this.applyGoodsUpdate === 'function') {
      this.applyGoodsUpdate(goods)
    }
    wx.showToast({ title: '已修改', icon: 'success', duration: 1000 })
  },

  removeEditGoods() {
    const { editIndex, orderGoods } = this.data
    if (editIndex < 0 || !orderGoods[editIndex]) return

    wx.showModal({
      title: '确认删除',
      content: `确定删除「${orderGoods[editIndex].dishName || '该菜品'}」吗？`,
      confirmColor: '#e54d42',
      success: (res) => {
        if (!res.confirm) return
        const goods = [...orderGoods]
        goods.splice(editIndex, 1)
        this.closeTagModal()
        if (typeof this.applyGoodsUpdate === 'function') {
          this.applyGoodsUpdate(goods)
        }
      }
    })
  }
}

module.exports = dishSpecEditor
