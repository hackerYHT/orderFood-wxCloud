// pages/myorder/myorder.js
const db = wx.cloud.database()

function pad(n) {
  return n < 10 ? '0' + n : '' + n
}

function toDate(time) {
  if (!time) return null
  if (time instanceof Date) return time
  return new Date(time)
}

function getDateKey(time) {
  const date = toDate(time)
  if (!date || Number.isNaN(date.getTime())) return 'unknown'
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function getTodayKey() {
  return getDateKey(new Date())
}

function formatDateLabel(dateKey) {
  if (!dateKey || dateKey === 'unknown') return '未知日期'
  const [y, m, d] = dateKey.split('-').map(Number)
  const today = new Date()
  const todayKey = getTodayKey()
  const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1)
  const yesterdayKey = getDateKey(yesterday)

  const weekNames = ['日', '一', '二', '三', '四', '五', '六']
  const date = new Date(y, m - 1, d)
  const week = weekNames[date.getDay()]
  const md = `${m}月${d}日`

  if (dateKey === todayKey) return `今天 ${md} 周${week}`
  if (dateKey === yesterdayKey) return `昨天 ${md} 周${week}`
  if (y === today.getFullYear()) return `${md} 周${week}`
  return `${y}年${md} 周${week}`
}

function formatTime(time) {
  const date = toDate(time)
  if (!date || Number.isNaN(date.getTime())) return ''
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function formatClockTime(time) {
  const date = toDate(time)
  if (!date || Number.isNaN(date.getTime())) return ''
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function enrichServeStatus(order) {
  const goods = Array.isArray(order.goods) ? order.goods : []
  const servedCount = goods.filter(item => item && item.served === true).length
  return {
    ...order,
    servedCount,
    allServed: goods.length > 0 && servedCount === goods.length
  }
}

Page({
  data: {
    orderList: [],
    orderGroups: [],
    orderPage: 0,
    orderPageSize: 20,
    orderHasMore: true,
    loadingOrders: false,
    payFilter: 0, // 0: 全部, 1: 未支付, 2: 已支付
    payFilterOptions: ['全部', '未支付', '已支付'],
    showTicketPreview: false,
    ticketPreviewText: '',
    previewing: false
  },

  onLoad() {
    this._expandedDates = {}
    this.loadOrders()
  },

  onShow() {
    this.loadOrders()
  },

  buildOrderGroups(orderList) {
    const todayKey = getTodayKey()
    const expandedMap = this._expandedDates || {}
    const groupMap = new Map()

    ;(orderList || []).forEach(order => {
      const enriched = enrichServeStatus(order)
      const dateKey = enriched.dateKey || getDateKey(enriched.createTime)
      if (!groupMap.has(dateKey)) {
        const expanded = expandedMap[dateKey] != null
          ? !!expandedMap[dateKey]
          : dateKey === todayKey
        expandedMap[dateKey] = expanded
        groupMap.set(dateKey, {
          dateKey,
          dateLabel: formatDateLabel(dateKey),
          expanded,
          isToday: dateKey === todayKey,
          orders: []
        })
      }
      groupMap.get(dateKey).orders.push(enriched)
    })

    this._expandedDates = expandedMap

    const groups = Array.from(groupMap.values()).map(group => ({
      ...group,
      count: group.orders.length,
      expanded: !!expandedMap[group.dateKey]
    }))

    // 日期降序（与订单 createTime desc 一致）
    groups.sort((a, b) => {
      if (a.dateKey === b.dateKey) return 0
      if (a.dateKey === 'unknown') return 1
      if (b.dateKey === 'unknown') return -1
      return a.dateKey < b.dateKey ? 1 : -1
    })

    return groups
  },

  setOrderList(orderList, extra = {}) {
    const normalizedList = (orderList || []).map(enrichServeStatus)
    const orderGroups = this.buildOrderGroups(normalizedList)
    this.setData({
      orderList: normalizedList,
      orderGroups,
      ...extra
    })
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

      const list = (res.data || []).map(order => {
        const dateKey = getDateKey(order.createTime)
        return {
          ...order,
          dateKey,
          createTimeText: order.createTime ? formatTime(order.createTime) : '',
          createTimeClock: order.createTime ? formatClockTime(order.createTime) : ''
        }
      })

      const newList = append ? this.data.orderList.concat(list) : list
      const hasMore = list.length === pageSize

      this.setOrderList(newList, {
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

  toggleDateGroup(e) {
    const dateKey = e.currentTarget.dataset.key
    if (!dateKey) return

    const expanded = !(this._expandedDates && this._expandedDates[dateKey])
    this._expandedDates = {
      ...(this._expandedDates || {}),
      [dateKey]: expanded
    }

    const orderGroups = (this.data.orderGroups || []).map(group => (
      group.dateKey === dateKey ? { ...group, expanded } : group
    ))
    this.setData({ orderGroups })
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
      orderList: [],
      orderGroups: []
    }, () => {
      this.loadOrders()
    })
  },

  stopPropagation() {},

  closeTicketPreview() {
    this.setData({ showTicketPreview: false })
  },

  async previewTicket(e) {
    const orderId = e.currentTarget.dataset.id
    if (!orderId || this.data.previewing) return
    this.setData({ previewing: true })
    wx.showLoading({ title: '生成预览...' })
    try {
      const res = await wx.cloud.callFunction({
        name: 'doBuy',
        data: {
          previewOnly: true,
          orderId
        }
      })
      wx.hideLoading()
      if (!res.result || !res.result.success) {
        throw new Error((res.result && res.result.error) || '预览失败')
      }
      this.setData({
        showTicketPreview: true,
        ticketPreviewText: res.result.previewText || ''
      })
    } catch (err) {
      wx.hideLoading()
      wx.showToast({ title: err.message || '预览失败', icon: 'none' })
    } finally {
      this.setData({ previewing: false })
    }
  },

  goEditOrder(e) {
    const { id } = e.currentTarget.dataset
    if (!id) return
    wx.removeStorageSync('editOrderContext')
    wx.navigateTo({
      url: `/pages/orderEdit/orderEdit?orderId=${id}`
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

      this.setOrderList(orderList)
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
  },

  async toggleGoodsServed(e) {
    const orderId = e.currentTarget.dataset.orderId
    const goodsIndex = Number(e.currentTarget.dataset.index)
    if (!orderId || Number.isNaN(goodsIndex) || goodsIndex < 0) return

    const order = this.data.orderList.find(item => item._id === orderId)
    if (!order || !Array.isArray(order.goods) || !order.goods[goodsIndex]) return

    const nextServed = !(order.goods[goodsIndex].served === true)
    const nextGoods = order.goods.map((goods, index) => (
      index === goodsIndex ? { ...goods, served: nextServed } : goods
    ))

    try {
      await db.collection('order').doc(orderId).update({
        data: { goods: nextGoods }
      })

      const orderList = this.data.orderList.map(item => (
        item._id === orderId ? { ...item, goods: nextGoods } : item
      ))
      this.setOrderList(orderList)
      wx.showToast({
        title: nextServed ? '已出餐' : '取消出餐',
        icon: 'none',
        duration: 800
      })
    } catch (err) {
      console.error('更新出餐状态失败', err)
      wx.showToast({ title: '更新失败', icon: 'none' })
    }
  },

  async markAllGoodsServed(e) {
    const orderId = e.currentTarget.dataset.orderId
    const allServed = e.currentTarget.dataset.all === true || e.currentTarget.dataset.all === 'true'
    if (!orderId) return

    const order = this.data.orderList.find(item => item._id === orderId)
    if (!order || !Array.isArray(order.goods) || order.goods.length === 0) return

    const nextServed = !allServed
    const nextGoods = order.goods.map(goods => ({
      ...goods,
      served: nextServed
    }))

    try {
      await db.collection('order').doc(orderId).update({
        data: { goods: nextGoods }
      })

      const orderList = this.data.orderList.map(item => (
        item._id === orderId ? { ...item, goods: nextGoods } : item
      ))
      this.setOrderList(orderList)
      wx.showToast({
        title: nextServed ? '已全部出餐' : '已取消全出',
        icon: 'none',
        duration: 1000
      })
    } catch (err) {
      console.error('批量更新出餐状态失败', err)
      wx.showToast({ title: '更新失败', icon: 'none' })
    }
  },

  deleteOrder(e) {
    const { id, queue } = e.currentTarget.dataset
    if (!id) return

    const queueText = queue ? `取餐号 #${queue}` : '该订单'
    wx.showModal({
      title: '确认删除',
      content: `确定删除${queueText}吗？删除后不可恢复。`,
      confirmColor: '#e54d42',
      success: async (res) => {
        if (!res.confirm) return

        wx.showLoading({ title: '删除中...' })
        try {
          await db.collection('order').doc(id).remove()
          const orderList = this.data.orderList.filter(order => order._id !== id)
          this.setOrderList(orderList)
          wx.showToast({ title: '已删除', icon: 'success' })
        } catch (err) {
          console.error('删除订单失败', err)
          wx.showToast({ title: '删除失败', icon: 'none' })
        } finally {
          wx.hideLoading()
        }
      }
    })
  }
})
