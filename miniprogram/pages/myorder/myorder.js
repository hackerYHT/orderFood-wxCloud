// pages/myorder/myorder.js
const app = getApp()
const db = wx.cloud.database()

Page({
  data: {
    orderList: [],
    orderPage: 0,
    orderPageSize: 20,
    orderHasMore: true,
    loadingOrders: false
  },

  onLoad() {
    this.loadOrders()
  },

  onShow() {
    this.loadOrders()
  },

  async loadOrders(append = false) {
    if (this.data.loadingOrders) {
      return
    }

    if (!append) {
      wx.showLoading({ title: '加载中...' })
    }

    try {
      this.setData({ loadingOrders: true })

      const openid = app.globalData.openid
      const pageSize = this.data.orderPageSize
      const page = append ? this.data.orderPage + 1 : 0
      const skip = page * pageSize

      const res = await db.collection('order')
        .where({
          _openid: openid,
          type: 'order'
        })
        .orderBy('createTime', 'desc')
        .skip(skip)
        .limit(pageSize)
        .get()

      const formatTime = (time) => {
        if (!time) return ''
        const date = time instanceof Date ? time : new Date(time)
        const pad = (n) => (n < 10 ? '0' + n : n)
        const y = date.getFullYear()
        const m = pad(date.getMonth() + 1)
        const d = pad(date.getDate())
        const hh = pad(date.getHours())
        const mm = pad(date.getMinutes())
        return `${y}-${m}-${d} ${hh}:${mm}`
      }

      const list = (res.data || []).map(order => ({
        ...order,
        createTimeText: order.createTime ? formatTime(order.createTime) : ''
      }))

      const newList = append ? this.data.orderList.concat(list) : list
      const hasMore = list.length === pageSize

      this.setData({
        orderList: newList,
        orderPage: page,
        orderHasMore: hasMore
      })
    } catch (err) {
      console.error('加载订单失败', err)
      wx.showToast({ title: '加载失败', icon: 'none' })
    } finally {
      wx.hideLoading()
      this.setData({ loadingOrders: false })
    }
  },

  onReachBottom() {
    if (this.data.orderHasMore && !this.data.loadingOrders) {
      this.loadOrders(true)
    }
  }
})
