// pages/myorder/myorder.js
const db = wx.cloud.database()

Page({
  data: {
    orderList: [],
    orderPage: 0,
    orderPageSize: 20,
    orderHasMore: true,
    loadingOrders: false,
    payFilter: 0, // 0: 全部, 1: 未支付, 2: 已支付
    payFilterOptions: ['全部', '未支付', '已支付']
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

      const pageSize = this.data.orderPageSize
      const page = append ? this.data.orderPage + 1 : 0
      const skip = page * pageSize
      const _ = db.command

      // 店员共用：所有员工查看全部点餐订单，不按 _openid 隔离
      const where = {
        type: 'order'
      }
      if (this.data.payFilter === 1) {
        where.pay_status = _.neq(true)
      } else if (this.data.payFilter === 2) {
        where.pay_status = true
      }

      const res = await db.collection('order')
        .where(where)
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
  },

  onPayFilterChange(e) {
    const index = Number(e.currentTarget.dataset.index)
    if (index === this.data.payFilter) {
      return
    }
    this.setData({
      payFilter: index,
      orderPage: 0,
      orderHasMore: true,
      orderList: []
    }, () => {
      this.loadOrders()
    })
  },

  async togglePayStatus(e) {
    const { id, status } = e.currentTarget.dataset
    if (!id) {
      return
    }

    const currentPaid = status === true || status === 'true'
    const newStatus = !currentPaid

    wx.showLoading({ title: '更新中...' })
    try {
      await db.collection('order').doc(id).update({
        data: { pay_status: newStatus }
      })

      let orderList = this.data.orderList.map(order => (
        order._id === id ? { ...order, pay_status: newStatus } : order
      ))

      if ((this.data.payFilter === 1 && newStatus) || (this.data.payFilter === 2 && !newStatus)) {
        orderList = orderList.filter(order => order._id !== id)
      }

      this.setData({ orderList })
      wx.showToast({
        title: newStatus ? '已标记为已支付' : '已标记为未支付',
        icon: 'none'
      })
    } catch (err) {
      console.error('更新支付状态失败', err)
      wx.showToast({ title: '更新失败', icon: 'none' })
    } finally {
      wx.hideLoading()
    }
  }
})
