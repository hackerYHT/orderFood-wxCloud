// pages/settle/settle.js
Page({
  data: {
    orderGoods: [],
    totalPrice: 0,
    finalPrice: 0,
    orderType: 'dineIn',
    tableNumber: '',
    remark: '',
    submitting: false,
    canSubmit: false
  },

  onLoad() {
    this.loadCartData()
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
        if (item.tagLabels && Array.isArray(item.tagLabels)) {
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
        goodsList.push({
          dishId: item.dishId || item.info._id,
          dishName: item.info.name,
          dishImage: item.info.image,
          price: unitPrice,
          basePrice: Number(item.basePrice) || Number(item.info.price) || 0,
          extraPrice: Number(item.extraPrice) || 0,
          count: item.count,
          tags: tagsArray,
          selectedOptions: item.selectedOptions || [],
          subtotal: (unitPrice * item.count).toFixed(2)
        })
      }

      const totalPrice = Number(cartData.totalPrice) || 0
      this.setData({
        orderGoods: goodsList,
        totalPrice,
        finalPrice: totalPrice,
        tableNumber: cartData.tableNumber || '',
        orderType: cartData.orderType || 'dineIn',
        remark: cartData.remark || ''
      })

      wx.removeStorageSync('settleCartData')
      this.updateCanSubmit()
    } catch (err) {
      console.error('加载购物车数据失败', err)
      wx.showToast({ title: '加载失败', icon: 'none' })
      setTimeout(() => wx.navigateBack(), 1500)
    }
  },

  selectOrderType(e) {
    this.setData({ orderType: e.currentTarget.dataset.value })
  },

  onTableNumberInput(e) {
    this.setData({ tableNumber: e.detail.value.trim() })
    this.updateCanSubmit()
  },

  onRemarkInput(e) {
    this.setData({ remark: e.detail.value })
  },

  updateCanSubmit() {
    const canSubmit = this.data.orderGoods.length > 0
    this.setData({ canSubmit })
  },

  async submitOrder() {
    if (!this.data.canSubmit || this.data.submitting) {
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
          tableNumber: this.data.tableNumber,
          orderType: this.data.orderType,
          remark: this.data.remark
        }
      })

      if (!doBuyRes.result || !doBuyRes.result.success) {
        throw new Error(doBuyRes.result?.error || '下单失败')
      }

      wx.hideLoading()

      const { printed, printReason, printError } = doBuyRes.result
      let toastTitle = '已提交并打印'
      if (!printed) {
        const reasonTitles = {
          no_printer: '已提交（未绑定打印机）',
          print_failed: '已提交（打印失败）',
          print_error: '已提交（打印异常）'
        }
        toastTitle = reasonTitles[printReason] || '已提交（打印未成功）'
        if (printError && printReason === 'print_failed') {
          console.warn('打印失败详情:', printError)
        }
      }
      wx.showToast({
        title: toastTitle,
        icon: printed ? 'success' : 'none',
        duration: 2000
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

  editOrder() {
    wx.navigateBack()
  },

  clearCart() {
    const pages = getCurrentPages()
    const indexPage = pages.find(page => page.route === 'pages/index/index')
    if (indexPage) {
      indexPage.updateCart({})
    }
  }
})
