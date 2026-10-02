// pages/settle/settle.js
const db = wx.cloud.database()
const { formatTagLabelSuffix } = require('../../utils/price.js')
const {
  expandCategoryRefTag,
  collectCategoryIdsFromDishes
} = require('../../utils/dishTags.js')
const {
  TABLE_OPTIONS,
  TABLE_PICKER_OPTIONS,
  calcOrderPrices,
  normalizeGoodsList,
  applyOrderTypePackagingDefaults
} = require('../../utils/orderGoods.js')

Page({
  data: {
    orderGoods: [],
    totalPrice: 0,
    finalPrice: 0,
    packagingFee: 0,
    packagingFeeItemCount: 0,
    packagingFeeCategories: [],
    orderType: 'dineIn',
    tablePickerOptions: TABLE_PICKER_OPTIONS,
    tablePickerIndex: 0,
    tableNumber: '',
    remark: '',
    payStatus: false,
    submitting: false,
    canSubmit: false,
    // 规格编辑弹窗（与点餐页购物车编辑一致）
    showTagModal: false,
    editIndex: -1,
    currentDish: null,
    selectedTags: {},
    modalDishCount: 1,
    modalTotalPrice: '0.00'
  },

  onLoad() {
    this.dishById = {}
    this.categoryDishesMap = {}
    this.loadPackagingFeeCategories().then(() => {
      this.loadCartData()
    })
  },

  async loadPackagingFeeCategories() {
    try {
      const res = await db.collection('dishCategory').orderBy('sort', 'asc').get()
      const categories = res.data || []
      this.setData({ packagingFeeCategories: categories })
      return categories
    } catch (err) {
      console.warn('加载分类打包费配置失败', err)
      return this.data.packagingFeeCategories
    }
  },

  recalcPrices(orderGoods) {
    const goods = orderGoods != null ? orderGoods : this.data.orderGoods
    return calcOrderPrices(goods, this.data.orderType, this.data.packagingFeeCategories)
  },

  applyPrices(goods, extra = {}) {
    const { totalPrice, packagingFee, packagingFeeItemCount, finalPrice, goods: list } = this.recalcPrices(goods)
    this.setData({
      orderGoods: list,
      totalPrice,
      packagingFee,
      packagingFeeItemCount,
      finalPrice,
      ...extra
    })
    this.updateCanSubmit()
  },

  loadCartData() {
    try {
      const cartData = wx.getStorageSync('settleCartData')
      if (!cartData) {
        wx.showToast({ title: '购物车为空', icon: 'none' })
        setTimeout(() => wx.navigateBack(), 1500)
        return
      }

      const goodsList = []
      for (let cartKey in cartData.cart) {
        const item = cartData.cart[cartKey]
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
        } else if (item.tags && typeof item.tags === 'object') {
          Object.keys(item.tags).forEach(tagId => {
            const value = item.tags[tagId]
            if (Array.isArray(value)) {
              tagsArray.push(...value)
            } else if (value) {
              tagsArray.push(value)
            }
          })
        }

        const unitPrice = Number(item.unitPrice) || Number(item.info.price) || 0
        if (item.info && item.info._id) {
          this.dishById[item.info._id] = item.info
        }
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
          tags: tagsArray,
          selectedTags: JSON.parse(JSON.stringify(item.tags || {})),
          selectedOptions: item.selectedOptions || [],
          needPackaging: item.needPackaging === true,
          subtotal: (unitPrice * item.count).toFixed(2)
        })
      }

      const orderType = cartData.orderType || 'dineIn'
      const annotated = normalizeGoodsList(goodsList, this.data.packagingFeeCategories)
      const hasExplicit = goodsList.some(item => item.needPackaging === true)
      const withPackaging = hasExplicit
        ? annotated
        : applyOrderTypePackagingDefaults(annotated, orderType, this.data.packagingFeeCategories)

      const rawTableNumber = (cartData.tableNumber || '').trim()
      const tableNumber = TABLE_OPTIONS.includes(rawTableNumber) ? rawTableNumber : ''
      const tablePickerIndex = tableNumber ? TABLE_PICKER_OPTIONS.indexOf(tableNumber) : 0

      this.setData({ orderType })
      this.applyPrices(withPackaging, {
        tableNumber,
        tablePickerIndex: tablePickerIndex >= 0 ? tablePickerIndex : 0,
        remark: cartData.remark || ''
      })

      wx.removeStorageSync('settleCartData')
    } catch (err) {
      console.error('加载购物车数据失败', err)
      wx.showToast({ title: '加载失败', icon: 'none' })
      setTimeout(() => wx.navigateBack(), 1500)
    }
  },

  selectOrderType(e) {
    const orderType = e.currentTarget.dataset.value
    const goods = applyOrderTypePackagingDefaults(
      this.data.orderGoods,
      orderType,
      this.data.packagingFeeCategories
    )
    this.setData({ orderType })
    this.applyPrices(goods)
  },

  toggleGoodsPackaging(e) {
    const index = Number(e.currentTarget.dataset.index)
    const goods = [...this.data.orderGoods]
    const item = goods[index]
    if (!item || !item.packagingFeeEligible) return
    goods[index] = { ...item, needPackaging: !item.needPackaging }
    this.applyPrices(goods)
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

  // 打开与购物车一致的规格编辑弹窗
  async openEditGoods(e) {
    const index = Number(e.currentTarget.dataset.index)
    const item = this.data.orderGoods[index]
    if (!item || !item.dishId) return

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
    this.applyPrices(goods)
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
        this.applyPrices(goods)
      }
    })
  },

  onTableNumberChange(e) {
    const index = Number(e.detail.value)
    const tableNumber = index > 0 && TABLE_PICKER_OPTIONS[index] ? TABLE_PICKER_OPTIONS[index] : ''
    this.setData({
      tablePickerIndex: index,
      tableNumber: TABLE_OPTIONS.includes(tableNumber) ? tableNumber : ''
    })
  },

  onRemarkInput(e) {
    this.setData({ remark: e.detail.value })
  },

  selectPayStatus(e) {
    const paid = e.currentTarget.dataset.value === 'true'
    this.setData({ payStatus: paid })
  },

  updateCanSubmit() {
    const canSubmit = this.data.orderGoods.length > 0
    this.setData({ canSubmit })
  },

  async submitOrder() {
    if (!this.data.canSubmit || this.data.submitting) {
      return
    }

    const editCtx = wx.getStorageSync('editOrderContext')
    if (editCtx && editCtx.orderId) {
      wx.showToast({ title: '编辑订单请点「完成添加」后保存', icon: 'none' })
      wx.navigateBack()
      return
    }

    if (!this.data.orderGoods.length) {
      wx.showToast({ title: '请先选择菜品', icon: 'none' })
      return
    }

    this.setData({ submitting: true })
    wx.showLoading({ title: '提交并打印中...' })

    try {
      const doBuyRes = await wx.cloud.callFunction({
        name: 'doBuy',
        data: {
          orderGoods: this.data.orderGoods,
          totalPrice: this.data.totalPrice,
          finalPrice: this.data.finalPrice,
          packagingFee: this.data.packagingFee,
          packagingFeeItemCount: this.data.packagingFeeItemCount,
          tableNumber: this.data.tableNumber,
          orderType: this.data.orderType,
          remark: this.data.remark,
          pay_status: this.data.payStatus
        }
      })

      if (!doBuyRes.result || !doBuyRes.result.success) {
        throw new Error(doBuyRes.result?.error || '下单失败')
      }

      wx.hideLoading()

      const { printed, printReason, printError, queueNumber, printPending } = doBuyRes.result
      let toastTitle = queueNumber ? `取餐号 #${queueNumber}` : '已提交并打印'
      if (printPending) {
        toastTitle = queueNumber ? `取餐号 #${queueNumber}` : '已提交'
      } else if (!printed) {
        const reasonTitles = {
          no_printer: queueNumber ? `取餐号 #${queueNumber}（未绑定打印机）` : '已提交（未绑定打印机）',
          print_failed: queueNumber ? `取餐号 #${queueNumber}（打印失败）` : '已提交（打印失败）',
          print_error: queueNumber ? `取餐号 #${queueNumber}（打印异常）` : '已提交（打印异常）'
        }
        toastTitle = reasonTitles[printReason] || (queueNumber ? `取餐号 #${queueNumber}（打印未成功）` : '已提交（打印未成功）')
        if (printError && printReason === 'print_failed') {
          console.warn('打印失败详情:', printError)
        }
      }
      wx.showToast({
        title: toastTitle,
        icon: (printed || printPending) ? 'success' : 'none',
        duration: 2500
      })

      this.clearCart()

      setTimeout(() => {
        wx.switchTab({ url: '/pages/myorder/myorder' })
      }, 1500)
    } catch (err) {
      console.error('创建订单失败', err)
      wx.hideLoading()
      wx.showToast({
        title: err.message || '下单失败',
        icon: 'none'
      })
    } finally {
      this.setData({ submitting: false })
    }
  },

  clearCart() {
    const pages = getCurrentPages()
    const indexPage = pages.find(page => page.route === 'pages/index/index')
    if (indexPage) {
      indexPage.updateCart({})
    }
  }
})
