// pages/settle/settle.js
const db = wx.cloud.database()
const { formatTagLabelSuffix } = require('../../utils/price.js')
const dishSpecEditor = require('../../utils/dishSpecEditor.js')
const {
  TABLE_OPTIONS,
  TABLE_PICKER_OPTIONS,
  calcOrderPrices,
  normalizeGoodsList,
  applyOrderTypePackagingDefaults
} = require('../../utils/orderGoods.js')

Page({
  ...dishSpecEditor,

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
    showTagModal: false,
    editIndex: -1,
    currentDish: null,
    selectedTags: {},
    modalDishCount: 1,
    modalTotalPrice: '0.00'
  },

  onLoad() {
    this.initDishSpecEditor()
    this.loadPackagingFeeCategories().then(() => {
      this.loadCartData()
    })
  },

  applyGoodsUpdate(goods) {
    this.applyPrices(goods)
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
    this.setData({ canSubmit: this.data.orderGoods.length > 0 })
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
