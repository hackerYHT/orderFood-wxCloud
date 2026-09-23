const db = wx.cloud.database()
const {
  TABLE_OPTIONS,
  TABLE_PICKER_OPTIONS,
  calcOrderPrices,
  normalizeGoodsList,
  resolveTablePickerIndex
} = require('../../utils/orderGoods.js')

Page({
  data: {
    orderId: '',
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
    pay_status: false,
    queueNumber: '',
    saving: false
  },

  onLoad(options) {
    const orderId = options.orderId || ''
    this.setData({ orderId })
    if (!orderId) {
      wx.showToast({ title: '订单不存在', icon: 'none' })
      setTimeout(() => wx.navigateBack(), 1500)
      return
    }
    this.loadPackagingFeeCategories().then(() => {
      this.loadOrder()
    })
  },

  onShow() {
    const ctx = wx.getStorageSync('editOrderContext')
    if (ctx && ctx.orderId === this.data.orderId && Array.isArray(ctx.goods)) {
      this.applyOrderState(ctx)
    }
  },

  onUnload() {
    // switchTab 时 onUnload 先于 tab 页激活，不能用 getCurrentPages 判断是否去 index
    if (wx.getStorageSync('editOrderReturnToIndex')) {
      wx.removeStorageSync('editOrderReturnToIndex')
      return
    }
    wx.removeStorageSync('editOrderContext')
  },

  async loadPackagingFeeCategories() {
    try {
      const res = await wx.cloud.callFunction({ name: 'getCategory' })
      const result = res.result || {}
      const categories = result.success ? (result.data || []) : []
      this.setData({ packagingFeeCategories: categories })
      return categories
    } catch (err) {
      console.warn('加载分类打包费配置失败', err)
      return this.data.packagingFeeCategories
    }
  },

  async loadOrder() {
    const ctx = wx.getStorageSync('editOrderContext')
    if (ctx && ctx.orderId === this.data.orderId && Array.isArray(ctx.goods)) {
      this.applyOrderState(ctx)
      return
    }

    wx.showLoading({ title: '加载中...' })
    try {
      const res = await db.collection('order').doc(this.data.orderId).get()
      const order = res.data
      if (!order || order.type !== 'order') {
        throw new Error('订单不存在')
      }
      this.applyOrderState(order)
      this.syncEditContext()
    } catch (err) {
      console.error('加载订单失败', err)
      wx.showToast({ title: '加载失败', icon: 'none' })
      setTimeout(() => wx.navigateBack(), 1500)
    } finally {
      wx.hideLoading()
    }
  },

  applyOrderState(order) {
    const goods = normalizeGoodsList(order.goods)
    const orderType = order.orderType || (order.tableNumber ? 'dineIn' : 'takeOut')
    const { totalPrice, packagingFee, packagingFeeItemCount, finalPrice } = calcOrderPrices(
      goods,
      orderType,
      this.data.packagingFeeCategories
    )
    const { tableNumber, tablePickerIndex } = resolveTablePickerIndex(order.tableNumber)

    this.setData({
      orderGoods: goods,
      orderType,
      totalPrice,
      packagingFee,
      packagingFeeItemCount,
      finalPrice,
      tableNumber,
      tablePickerIndex,
      remark: order.remark || '',
      pay_status: order.pay_status === true,
      queueNumber: order.queueNumber || ''
    })
  },

  syncEditContext() {
    wx.setStorageSync('editOrderContext', {
      orderId: this.data.orderId,
      goods: this.data.orderGoods,
      orderType: this.data.orderType,
      tableNumber: this.data.tableNumber,
      tablePickerIndex: this.data.tablePickerIndex,
      remark: this.data.remark,
      pay_status: this.data.pay_status,
      queueNumber: this.data.queueNumber
    })
  },

  recalcAndSet(goods, orderType) {
    const nextType = orderType != null ? orderType : this.data.orderType
    const list = normalizeGoodsList(goods)
    const { totalPrice, packagingFee, packagingFeeItemCount, finalPrice } = calcOrderPrices(
      list,
      nextType,
      this.data.packagingFeeCategories
    )
    this.setData({
      orderGoods: list,
      orderType: nextType,
      totalPrice,
      packagingFee,
      packagingFeeItemCount,
      finalPrice
    })
    this.syncEditContext()
  },

  selectOrderType(e) {
    const orderType = e.currentTarget.dataset.value
    this.recalcAndSet(this.data.orderGoods, orderType)
  },

  onTableNumberChange(e) {
    const index = Number(e.detail.value)
    const picked = index > 0 && TABLE_PICKER_OPTIONS[index] ? TABLE_PICKER_OPTIONS[index] : ''
    const tableNumber = TABLE_OPTIONS.includes(picked) ? picked : ''
    this.setData({
      tablePickerIndex: index,
      tableNumber
    })
    this.syncEditContext()
  },

  onRemarkInput(e) {
    this.setData({ remark: e.detail.value })
    this.syncEditContext()
  },

  onGoodsIncrease(e) {
    const index = Number(e.currentTarget.dataset.index)
    const goods = [...this.data.orderGoods]
    if (!goods[index]) return
    goods[index] = { ...goods[index], count: goods[index].count + 1 }
    this.recalcAndSet(goods)
  },

  onGoodsDecrease(e) {
    const index = Number(e.currentTarget.dataset.index)
    const goods = [...this.data.orderGoods]
    if (!goods[index]) return
    const nextCount = goods[index].count - 1
    if (nextCount <= 0) {
      goods.splice(index, 1)
    } else {
      goods[index] = { ...goods[index], count: nextCount }
    }
    this.recalcAndSet(goods)
  },

  onGoodsRemove(e) {
    const index = Number(e.currentTarget.dataset.index)
    const goods = [...this.data.orderGoods]
    goods.splice(index, 1)
    this.recalcAndSet(goods)
  },

  goAddDishes() {
    if (!this.data.orderGoods.length) {
      wx.showModal({
        title: '提示',
        content: '当前没有菜品，去点餐页添加？',
        success: (res) => {
          if (res.confirm) {
            this.syncEditContext()
            wx.setStorageSync('editOrderReturnToIndex', true)
            wx.switchTab({ url: '/pages/index/index' })
          }
        }
      })
      return
    }
    this.syncEditContext()
    wx.setStorageSync('editOrderReturnToIndex', true)
    wx.switchTab({ url: '/pages/index/index' })
  },

  async saveOrder() {
    if (this.data.saving) return

    const goods = normalizeGoodsList(this.data.orderGoods)
    if (!goods.length) {
      wx.showToast({ title: '请至少保留一个菜品', icon: 'none' })
      return
    }

    const orderType = this.data.orderType || (this.data.tableNumber ? 'dineIn' : 'takeOut')
    const { totalPrice, packagingFee, packagingFeeItemCount, finalPrice } = calcOrderPrices(
      goods,
      orderType,
      this.data.packagingFeeCategories
    )

    this.setData({ saving: true })
    wx.showLoading({ title: '保存中...' })

    try {
      await db.collection('order').doc(this.data.orderId).update({
        data: {
          goods,
          totalPrice,
          packagingFee,
          packagingFeeItemCount,
          finalPrice,
          orderType,
          tableNumber: this.data.tableNumber || '',
          remark: this.data.remark || '',
          updateTime: db.serverDate()
        }
      })

      wx.removeStorageSync('editOrderContext')
      wx.hideLoading()
      wx.showToast({ title: '已保存（未打印）', icon: 'success' })
      setTimeout(() => wx.navigateBack(), 1200)
    } catch (err) {
      console.error('保存订单失败', err)
      wx.hideLoading()
      wx.showToast({ title: '保存失败', icon: 'none' })
    } finally {
      this.setData({ saving: false })
    }
  }
})
