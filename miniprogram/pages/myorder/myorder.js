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

function getDayRange(dateKey) {
  if (!dateKey || dateKey === 'unknown') return null
  const [y, m, d] = dateKey.split('-').map(Number)
  if (!y || !m || !d) return null
  const start = new Date(y, m - 1, d, 0, 0, 0, 0)
  const end = new Date(y, m - 1, d + 1, 0, 0, 0, 0)
  return { start, end }
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
    orderGroups: [],
    orderPageSize: 20,
    loadingSummary: false,
    loadingMoreDates: false,
    summaryHasMore: false,
    loadError: '',
    payFilter: 0, // 0: 全部, 1: 未支付, 2: 已支付
    payFilterOptions: ['全部', '未支付', '已支付'],
    showTicketPreview: false,
    ticketPreviewText: '',
    previewing: false
  },

  onLoad() {
    this._expandedDates = {}
    this._summaryToken = 0
    this._dayLoadTokens = {}
    this._summaryLoading = false
    this._historyBefore = null // 已展示日期中最早一天的 0 点，用于继续往前翻
  },

  onShow() {
    const now = Date.now()
    // 短时间重复进入订单页时不重扫，避免每次都转圈
    if (
      this.data.orderGroups.length > 0 &&
      !this.data.loadError &&
      this._lastSummaryAt &&
      this._lastSummaryFilter === this.data.payFilter &&
      now - this._lastSummaryAt < 15000
    ) {
      return
    }
    this.loadDateSummaries()
  },

  buildOrderWhere(extra = {}) {
    const _ = db.command
    const where = {
      type: 'order',
      ...extra
    }
    if (this.data.payFilter === 1) {
      where.pay_status = _.neq(true)
    } else if (this.data.payFilter === 2) {
      where.pay_status = true
    }
    return where
  },

  mapOrderRow(order) {
    if (!order || !order._id || String(order._id).startsWith('queueCounter')) {
      return null
    }
    const dateKey = getDateKey(order.createTime)
    // goods 需保留完整字段，出餐标记会整数组写回数据库
    const goods = Array.isArray(order.goods)
      ? order.goods.map(item => ({ ...item, served: item.served === true }))
      : []
    return enrichServeStatus({
      _id: order._id,
      type: order.type,
      goods,
      finalPrice: order.finalPrice,
      totalPrice: order.totalPrice,
      packagingFee: order.packagingFee,
      orderType: order.orderType,
      pay_status: order.pay_status,
      printStatus: order.printStatus,
      remark: order.remark || '',
      tableNumber: order.tableNumber || '',
      queueNumber: order.queueNumber || '',
      createTime: order.createTime,
      dateKey,
      createTimeText: order.createTime ? formatTime(order.createTime) : '',
      createTimeClock: order.createTime ? formatClockTime(order.createTime) : ''
    })
  },

  findOrderInGroups(orderId) {
    const groups = this.data.orderGroups || []
    for (let gi = 0; gi < groups.length; gi += 1) {
      const orders = groups[gi].orders || []
      const oi = orders.findIndex(item => item._id === orderId)
      if (oi >= 0) {
        return { groupIndex: gi, orderIndex: oi, order: orders[oi], dateKey: groups[gi].dateKey }
      }
    }
    return null
  },

  patchOrderInGroups(orderId, updater) {
    const found = this.findOrderInGroups(orderId)
    if (!found) return false
    const { groupIndex, orderIndex, order } = found
    const nextOrder = enrichServeStatus(updater(order))
    const key = `orderGroups[${groupIndex}].orders[${orderIndex}]`
    const allServedKey = `orderGroups[${groupIndex}].orders[${orderIndex}].allServed`
    const servedCountKey = `orderGroups[${groupIndex}].orders[${orderIndex}].servedCount`
    this.setData({
      [key]: nextOrder,
      [allServedKey]: nextOrder.allServed,
      [servedCountKey]: nextOrder.servedCount
    })
    return true
  },

  removeOrderFromGroups(orderId) {
    const found = this.findOrderInGroups(orderId)
    if (!found) return
    const { groupIndex, orderIndex } = found
    const group = this.data.orderGroups[groupIndex]
    const nextOrders = group.orders.filter((_, idx) => idx !== orderIndex)
    const nextCount = Math.max(0, (Number(group.count) || 0) - 1)
    if (nextCount === 0) {
      const orderGroups = this.data.orderGroups.filter((_, idx) => idx !== groupIndex)
      this.setData({ orderGroups })
      return
    }
    this.setData({
      [`orderGroups[${groupIndex}].orders`]: nextOrders,
      [`orderGroups[${groupIndex}].count`]: nextCount
    })
  },

  listRecentDateKeys(days = 3) {
    const today = new Date()
    const keys = []
    for (let i = 0; i < days; i += 1) {
      const date = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i)
      keys.push(getDateKey(date))
    }
    return keys
  },

  async countOrdersForDate(dateKey) {
    const range = getDayRange(dateKey)
    if (!range) return 0
    const _ = db.command
    const res = await db.collection('order')
      .where(this.buildOrderWhere({
        createTime: _.gte(range.start).and(_.lt(range.end))
      }))
      .count()
    return Number(res.total) || 0
  },

  buildDateGroup(dateKey, count, expandedMap, todayKey) {
    return {
      dateKey,
      dateLabel: formatDateLabel(dateKey),
      count,
      expanded: !!expandedMap[dateKey],
      isToday: dateKey === todayKey,
      loaded: false,
      loading: false,
      orders: []
    }
  },

  sortDateGroups(groups) {
    return groups.sort((a, b) => {
      if (a.dateKey === b.dateKey) return 0
      if (a.dateKey === 'unknown') return 1
      if (b.dateKey === 'unknown') return -1
      return a.dateKey < b.dateKey ? 1 : -1
    })
  },

  updateHistoryCursor(groups) {
    if (!groups.length) {
      this._historyBefore = null
      return
    }
    const oldestKey = groups[groups.length - 1].dateKey
    const range = getDayRange(oldestKey)
    this._historyBefore = range ? range.start : null
  },

  // 从某时间点往前扫 pages 页，返回日期->单量，以及本批最早时间（用于继续往前翻）
  async scanHistoryPages(beforeDate, pages = 10) {
    const _ = db.command
    const pageSize = this.data.orderPageSize
    const countMap = new Map()
    let page = 0
    let hasMore = true
    let oldestTime = null
    const whereExtra = beforeDate
      ? { createTime: _.lt(beforeDate) }
      : {}

    while (hasMore && page < pages) {
      const res = await db.collection('order')
        .where(this.buildOrderWhere(whereExtra))
        .orderBy('createTime', 'desc')
        .skip(page * pageSize)
        .limit(pageSize)
        .get()
      const raw = res.data || []
      raw.forEach(item => {
        if (!item || !item._id || String(item._id).startsWith('queueCounter')) return
        if (item.type && item.type !== 'order') return
        const dateKey = getDateKey(item.createTime)
        countMap.set(dateKey, (countMap.get(dateKey) || 0) + 1)
        const t = toDate(item.createTime)
        if (t && (!oldestTime || t.getTime() < oldestTime.getTime())) {
          oldestTime = t
        }
      })
      hasMore = raw.length === pageSize
      page += 1
    }

    return { countMap, hasMore, oldestTime }
  },

  async loadDateSummaries() {
    if (this._summaryLoading) return
    this._summaryLoading = true

    const token = ++this._summaryToken
    const todayKey = getTodayKey()
    const expandedMap = this._expandedDates || {}
    if (expandedMap[todayKey] == null) {
      expandedMap[todayKey] = true
    }
    this._expandedDates = expandedMap
    this._historyBefore = null

    wx.showLoading({ title: '加载中...' })
    this.setData({ loadingSummary: true, loadError: '', summaryHasMore: false })

    try {
      // 默认只展示最近 3 天
      const dateKeys = this.listRecentDateKeys(3)
      const results = await Promise.all(dateKeys.map(async dateKey => {
        try {
          const total = await this.countOrdersForDate(dateKey)
          return { dateKey, total, ok: true }
        } catch (err) {
          return { dateKey, total: 0, ok: false, err }
        }
      }))

      let orderGroups = []
      const allFailed = results.every(item => !item.ok)

      if (allFailed) {
        // count 不可用时：扫 10 页，但界面仍只先露出最近 3 个日期
        const scanned = await this.scanHistoryPages(null, 10)
        const allKeys = Array.from(scanned.countMap.keys()).sort((a, b) => (a < b ? 1 : -1))
        const firstThree = allKeys.slice(0, 3)
        orderGroups = firstThree.map(dateKey => (
          this.buildDateGroup(dateKey, scanned.countMap.get(dateKey) || 0, expandedMap, todayKey)
        ))
        this.setData({ summaryHasMore: scanned.hasMore || allKeys.length > 3 })
      } else {
        orderGroups = results
          .filter(item => item.ok && item.total > 0)
          .map(item => this.buildDateGroup(item.dateKey, item.total, expandedMap, todayKey))
        // 再往前探 1 页，判断有没有更早订单
        try {
          const probe = await this.scanHistoryPages(getDayRange(dateKeys[dateKeys.length - 1]).start, 1)
          this.setData({ summaryHasMore: probe.hasMore || probe.countMap.size > 0 })
        } catch (e) {
          this.setData({ summaryHasMore: true })
        }
      }

      if (token !== this._summaryToken) return

      orderGroups = this.sortDateGroups(orderGroups)
      this.updateHistoryCursor(orderGroups)
      this._lastSummaryAt = Date.now()
      this._lastSummaryFilter = this.data.payFilter
      this.setData({
        orderGroups,
        loadError: ''
      })
    } catch (err) {
      console.error('加载日期汇总失败', err)
      const tip = (err && (err.errMsg || err.message)) || ''
      const needIndex = /index|索引/i.test(tip)
      const loadError = needIndex
        ? '缺少数据库索引：请在云开发控制台为 order 集合添加 type + createTime 索引'
        : ('加载失败：' + (tip || '请重试'))
      if (token === this._summaryToken) {
        this.setData({
          orderGroups: [],
          loadError,
          summaryHasMore: false
        })
      }
      wx.showToast({
        title: needIndex ? '缺少查询索引' : '加载失败',
        icon: 'none'
      })
    } finally {
      this._summaryLoading = false
      if (token === this._summaryToken) {
        wx.hideLoading()
        this.setData({ loadingSummary: false })
      }
    }

    if (token === this._summaryToken) {
      const todayGroup = (this.data.orderGroups || []).find(g => g.dateKey === todayKey && g.expanded)
      if (todayGroup) {
        this.loadOrdersForDate(todayKey, { force: true })
      }
    }
  },

  async loadMoreDateGroups() {
    if (this.data.loadingMoreDates || this.data.loadingSummary || !this.data.summaryHasMore) return
    if (!this._historyBefore) {
      this.setData({ summaryHasMore: false })
      return
    }

    this.setData({ loadingMoreDates: true })
    try {
      const todayKey = getTodayKey()
      const expandedMap = this._expandedDates || {}
      let orderGroups = [...(this.data.orderGroups || [])]
      let hasMore = true
      let addedAny = false
      // 一次点击最多连扫 3 轮，避免边界日期重复扫不出新天时卡住
      for (let round = 0; round < 3 && hasMore; round += 1) {
        if (!this._historyBefore) {
          hasMore = false
          break
        }
        const existing = new Set(orderGroups.map(g => g.dateKey))
        const scanned = await this.scanHistoryPages(this._historyBefore, 10)
        hasMore = scanned.hasMore

        if (scanned.oldestTime) {
          this._historyBefore = scanned.oldestTime
        }

        const newKeys = Array.from(scanned.countMap.keys()).filter(key => !existing.has(key))
        const additions = []
        for (let i = 0; i < newKeys.length; i += 1) {
          const dateKey = newKeys[i]
          let count = scanned.countMap.get(dateKey) || 0
          try {
            count = await this.countOrdersForDate(dateKey)
          } catch (e) {
            // 保留扫描计数
          }
          if (count > 0) {
            additions.push(this.buildDateGroup(dateKey, count, expandedMap, todayKey))
          }
        }

        if (additions.length) {
          addedAny = true
          orderGroups = this.sortDateGroups([...orderGroups, ...additions])
          break
        }
        if (!hasMore) break
      }

      this.setData({
        orderGroups,
        summaryHasMore: hasMore
      })

      if (!addedAny && !hasMore) {
        wx.showToast({ title: '没有更多了', icon: 'none' })
      }
    } catch (err) {
      console.error('加载更多日期失败', err)
      wx.showToast({ title: '加载更多失败', icon: 'none' })
    } finally {
      this.setData({ loadingMoreDates: false })
    }
  },

  async fetchOrdersByDate(dateKey) {
    const range = getDayRange(dateKey)
    const pageSize = this.data.orderPageSize
    let list = []

    // 优先按日期范围查；失败则退回扫表再按日期过滤
    if (range) {
      try {
        const _ = db.command
        let page = 0
        let hasMore = true
        while (hasMore && page < 50) {
          const res = await db.collection('order')
            .where(this.buildOrderWhere({
              createTime: _.gte(range.start).and(_.lt(range.end))
            }))
            .orderBy('createTime', 'desc')
            .skip(page * pageSize)
            .limit(pageSize)
            .get()
          const raw = res.data || []
          list = list.concat(raw.map(item => this.mapOrderRow(item)).filter(Boolean))
          hasMore = raw.length === pageSize
          page += 1
        }
        return list
      } catch (err) {
        console.warn('按日期范围查询失败，改用扫表过滤', err)
      }
    }

    let page = 0
    let hasMore = true
    while (hasMore && page < 50) {
      const res = await db.collection('order')
        .where(this.buildOrderWhere())
        .orderBy('createTime', 'desc')
        .skip(page * pageSize)
        .limit(pageSize)
        .get()
      const raw = res.data || []
      raw.forEach(item => {
        const row = this.mapOrderRow(item)
        if (row && row.dateKey === dateKey) list.push(row)
      })
      hasMore = raw.length === pageSize
      // 已经扫过更早日期时可以提前结束
      if (raw.length) {
        const lastKey = getDateKey(raw[raw.length - 1].createTime)
        if (lastKey !== 'unknown' && lastKey < dateKey) {
          hasMore = false
        }
      }
      page += 1
    }
    return list
  },

  async loadOrdersForDate(dateKey, { force = false } = {}) {
    if (!dateKey) return
    const groups = this.data.orderGroups || []
    const groupIndex = groups.findIndex(g => g.dateKey === dateKey)
    if (groupIndex < 0) return

    const group = groups[groupIndex]
    if (!force && group.loaded) return
    if (group.loading) return

    const dayToken = (this._dayLoadTokens[dateKey] || 0) + 1
    this._dayLoadTokens[dateKey] = dayToken

    this.setData({
      [`orderGroups[${groupIndex}].loading`]: true
    })

    try {
      const list = await this.fetchOrdersByDate(dateKey)
      if (this._dayLoadTokens[dateKey] !== dayToken) return

      const latestIndex = (this.data.orderGroups || []).findIndex(g => g.dateKey === dateKey)
      if (latestIndex < 0) return

      this.setData({
        [`orderGroups[${latestIndex}].orders`]: list,
        [`orderGroups[${latestIndex}].count`]: list.length,
        [`orderGroups[${latestIndex}].loaded`]: true,
        [`orderGroups[${latestIndex}].loading`]: false,
        [`orderGroups[${latestIndex}].expanded`]: true
      })
      this._expandedDates = {
        ...(this._expandedDates || {}),
        [dateKey]: true
      }
    } catch (err) {
      console.error('加载当日订单失败', dateKey, err)
      const latestIndex = (this.data.orderGroups || []).findIndex(g => g.dateKey === dateKey)
      if (latestIndex >= 0 && this._dayLoadTokens[dateKey] === dayToken) {
        this.setData({
          [`orderGroups[${latestIndex}].loading`]: false
        })
      }
      wx.showToast({ title: '加载当天订单失败', icon: 'none' })
    }
  },

  async toggleDateGroup(e) {
    const dateKey = e.currentTarget.dataset.key
    if (!dateKey) return

    const groupIndex = (this.data.orderGroups || []).findIndex(g => g.dateKey === dateKey)
    if (groupIndex < 0) return

    const group = this.data.orderGroups[groupIndex]
    const expanded = !group.expanded
    this._expandedDates = {
      ...(this._expandedDates || {}),
      [dateKey]: expanded
    }

    this.setData({
      [`orderGroups[${groupIndex}].expanded`]: expanded
    })

    if (expanded && !group.loaded) {
      await this.loadOrdersForDate(dateKey, { force: true })
    }
  },

  onPayFilterChange(e) {
    const index = Number(e.currentTarget.dataset.index)
    if (index === this.data.payFilter) {
      return
    }
    this._expandedDates = {}
    this.setData({
      payFilter: index,
      orderGroups: []
    }, () => {
      this.loadDateSummaries()
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
    if (!id) return

    const currentPaid = status === true || status === 'true'
    const newStatus = !currentPaid

    wx.showLoading({ title: '更新中...' })
    try {
      await db.collection('order').doc(id).update({
        data: { pay_status: newStatus }
      })

      if ((this.data.payFilter === 1 && newStatus) || (this.data.payFilter === 2 && !newStatus)) {
        this.removeOrderFromGroups(id)
      } else {
        this.patchOrderInGroups(id, order => ({ ...order, pay_status: newStatus }))
      }

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

    const found = this.findOrderInGroups(orderId)
    if (!found || !Array.isArray(found.order.goods) || !found.order.goods[goodsIndex]) return

    const nextServed = !(found.order.goods[goodsIndex].served === true)
    const nextGoods = found.order.goods.map((goods, index) => (
      index === goodsIndex ? { ...goods, served: nextServed } : goods
    ))

    try {
      await db.collection('order').doc(orderId).update({
        data: { goods: nextGoods }
      })
      this.patchOrderInGroups(orderId, order => ({ ...order, goods: nextGoods }))
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

    const found = this.findOrderInGroups(orderId)
    if (!found || !Array.isArray(found.order.goods) || found.order.goods.length === 0) return

    const nextServed = !allServed
    const nextGoods = found.order.goods.map(goods => ({
      ...goods,
      served: nextServed
    }))

    try {
      await db.collection('order').doc(orderId).update({
        data: { goods: nextGoods }
      })
      this.patchOrderInGroups(orderId, order => ({ ...order, goods: nextGoods }))
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
          this.removeOrderFromGroups(id)
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
