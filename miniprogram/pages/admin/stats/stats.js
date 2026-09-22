// pages/admin/stats/stats.js
const db = wx.cloud.database()

const RANGE_OPTIONS = [
  { key: 'today', label: '今日' },
  { key: 'yesterday', label: '昨日' },
  { key: 'week', label: '本周' },
  { key: 'custom', label: '自定义' }
]

function pad(n) {
  return n < 10 ? '0' + n : ''
}

function formatDateKey(date) {
  const y = date.getFullYear()
  const m = pad(date.getMonth() + 1)
  const d = pad(date.getDate())
  return `${y}-${m}-${d}`
}

function parseDateKey(key) {
  const parts = (key || '').split('-').map(Number)
  if (parts.length !== 3 || parts.some(isNaN)) {
    return new Date()
  }
  const date = new Date(parts[0], parts[1] - 1, parts[2])
  date.setHours(0, 0, 0, 0)
  return date
}

function getDayEnd(date) {
  const end = new Date(date)
  end.setHours(23, 59, 59, 999)
  return end
}

function getWeekStart(date = new Date()) {
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  const day = d.getDay()
  const diff = day === 0 ? 6 : day - 1
  d.setDate(d.getDate() - diff)
  return d
}

function getDateRange(rangeKey, customStart, customEnd) {
  const now = new Date()
  const todayStart = new Date(now)
  todayStart.setHours(0, 0, 0, 0)

  if (rangeKey === 'today') {
    return { start: todayStart, end: getDayEnd(now), label: '今日' }
  }
  if (rangeKey === 'yesterday') {
    const start = new Date(todayStart)
    start.setDate(start.getDate() - 1)
    return { start, end: getDayEnd(start), label: '昨日' }
  }
  if (rangeKey === 'week') {
    return { start: getWeekStart(now), end: getDayEnd(now), label: '本周' }
  }

  const start = parseDateKey(customStart)
  const endDate = parseDateKey(customEnd)
  const end = getDayEnd(endDate)
  if (start > end) {
    return { start: endDate, end: getDayEnd(start), label: `${formatDateKey(endDate)} ~ ${formatDateKey(start)}` }
  }
  return { start, end, label: `${formatDateKey(start)} ~ ${formatDateKey(endDate)}` }
}

function formatMoney(value) {
  return (Number(value) || 0).toFixed(2)
}

function resolveItemCategory(item, dishMap) {
  if (item.categoryId) {
    return {
      key: item.categoryId,
      name: (item.categoryName || '').trim() || '未命名分类'
    }
  }

  const dishId = item.dishId || item.goodsId || ''
  if (dishId && dishMap[dishId]) {
    const dish = dishMap[dishId]
    const name = (dish.categoryName || '').trim()
    if (dish.categoryId) {
      return { key: dish.categoryId, name: name || '未命名分类' }
    }
    if (name) {
      return { key: `name:${name}`, name }
    }
  }

  const categoryName = (item.categoryName || '').trim()
  if (categoryName) {
    return { key: `name:${categoryName}`, name: categoryName }
  }

  return { key: '__uncategorized__', name: '未分类' }
}

function collectDishIdsNeedingLookup(orders) {
  const ids = new Set()
  orders.forEach(order => {
    ;(order.goods || []).forEach(item => {
      if (item.categoryId) return
      const dishId = item.dishId || item.goodsId || ''
      if (dishId) ids.add(dishId)
    })
  })
  return [...ids]
}

async function fetchDishMapByIds(dishIds) {
  const uniqueIds = (dishIds || []).filter(Boolean)
  if (!uniqueIds.length) return {}

  const map = {}
  const _ = db.command
  const batchSize = 20

  for (let i = 0; i < uniqueIds.length; i += batchSize) {
    const batch = uniqueIds.slice(i, i + batchSize)
    const res = await db.collection('dish')
      .where({ _id: _.in(batch) })
      .field({ categoryId: true, categoryName: true })
      .get()

    ;(res.data || []).forEach(dish => {
      map[dish._id] = dish
    })
  }

  return map
}

function aggregateOrders(orders, dishMap = {}) {
  let totalSales = 0
  let paidAmount = 0
  let unpaidAmount = 0
  let paidCount = 0
  let unpaidCount = 0
  let dineInCount = 0
  let takeOutCount = 0
  let dineInAmount = 0
  let takeOutAmount = 0
  const dishMapAgg = {}
  const categoryMap = {}

  orders.forEach(order => {
    const amount = Number(order.finalPrice) || 0
    totalSales += amount

    if (order.pay_status === true) {
      paidAmount += amount
      paidCount += 1
    } else {
      unpaidAmount += amount
      unpaidCount += 1
    }

    if (order.orderType === 'takeOut') {
      takeOutCount += 1
      takeOutAmount += amount
    } else {
      dineInCount += 1
      dineInAmount += amount
    }

    ;(order.goods || []).forEach(item => {
      const name = item.dishName || item.goodsName || '未知菜品'
      const count = Number(item.count) || 1
      const lineAmount = (Number(item.price) || 0) * count

      if (!dishMapAgg[name]) {
        dishMapAgg[name] = { name, count: 0, amount: 0 }
      }
      dishMapAgg[name].count += count
      dishMapAgg[name].amount += lineAmount

      const category = resolveItemCategory(item, dishMap)
      if (!categoryMap[category.key]) {
        categoryMap[category.key] = { name: category.name, count: 0, amount: 0 }
      }
      categoryMap[category.key].count += count
      categoryMap[category.key].amount += lineAmount
    })
  })

  const topDishes = Object.values(dishMapAgg)
    .sort((a, b) => b.count - a.count)
    .map((item, index) => ({
      rank: index + 1,
      name: item.name,
      count: item.count,
      amountText: formatMoney(item.amount)
    }))

  const topCategories = Object.values(categoryMap)
    .sort((a, b) => b.count - a.count)
    .map((item, index) => ({
      rank: index + 1,
      name: item.name,
      count: item.count,
      amountText: formatMoney(item.amount)
    }))

  const categoryTotalCount = topCategories.reduce((sum, item) => sum + item.count, 0)
  const categoryTotalAmount = Object.values(categoryMap).reduce((sum, item) => sum + item.amount, 0)
  const dishTotalCount = topDishes.reduce((sum, item) => sum + item.count, 0)
  const dishTotalAmount = Object.values(dishMapAgg).reduce((sum, item) => sum + item.amount, 0)

  return {
    orderCount: orders.length,
    totalSalesText: formatMoney(totalSales),
    paidAmountText: formatMoney(paidAmount),
    unpaidAmountText: formatMoney(unpaidAmount),
    paidCount,
    unpaidCount,
    dineInCount,
    takeOutCount,
    dineInAmountText: formatMoney(dineInAmount),
    takeOutAmountText: formatMoney(takeOutAmount),
    topDishes,
    topCategories,
    categoryTotalCount,
    categoryTotalAmountText: formatMoney(categoryTotalAmount),
    dishTotalCount,
    dishTotalAmountText: formatMoney(dishTotalAmount)
  }
}

async function fetchOrdersInRange(start, end) {
  const _ = db.command
  const pageSize = 100
  let all = []
  let skip = 0

  while (true) {
    const res = await db.collection('order')
      .where({
        type: 'order',
        createTime: _.gte(start).and(_.lte(end))
      })
      .orderBy('createTime', 'desc')
      .skip(skip)
      .limit(pageSize)
      .get()

    const batch = res.data || []
    all = all.concat(batch)
    if (batch.length < pageSize) {
      break
    }
    skip += pageSize
  }

  return all
}

Page({
  data: {
    rangeOptions: RANGE_OPTIONS,
    rangeKey: 'today',
    customStartDate: formatDateKey(new Date()),
    customEndDate: formatDateKey(new Date()),
    rangeLabel: '今日',
    loading: false,
    orderCount: 0,
    totalSalesText: '0.00',
    paidAmountText: '0.00',
    unpaidAmountText: '0.00',
    paidCount: 0,
    unpaidCount: 0,
    dineInCount: 0,
    takeOutCount: 0,
    dineInAmountText: '0.00',
    takeOutAmountText: '0.00',
    topDishes: [],
    topCategories: [],
    categoryTotalCount: 0,
    categoryTotalAmountText: '0.00',
    dishTotalCount: 0,
    dishTotalAmountText: '0.00'
  },

  onLoad() {
    this.loadStats()
  },

  onPullDownRefresh() {
    this.loadStats().finally(() => {
      wx.stopPullDownRefresh()
    })
  },

  onRangeChange(e) {
    const key = e.currentTarget.dataset.key
    if (!key || key === this.data.rangeKey) {
      return
    }
    this.setData({ rangeKey: key }, () => {
      this.loadStats()
    })
  },

  onCustomStartChange(e) {
    this.setData({ customStartDate: e.detail.value }, () => {
      if (this.data.rangeKey === 'custom') {
        this.loadStats()
      }
    })
  },

  onCustomEndChange(e) {
    this.setData({ customEndDate: e.detail.value }, () => {
      if (this.data.rangeKey === 'custom') {
        this.loadStats()
      }
    })
  },

  async loadStats() {
    if (this.data.loading) {
      return
    }

    const { rangeKey, customStartDate, customEndDate } = this.data
    const { start, end, label } = getDateRange(rangeKey, customStartDate, customEndDate)

    this.setData({ loading: true })
    wx.showLoading({ title: '统计中...' })

    try {
      const orders = await fetchOrdersInRange(start, end)
      const dishIds = collectDishIdsNeedingLookup(orders)
      const dishMap = await fetchDishMapByIds(dishIds)
      const stats = aggregateOrders(orders, dishMap)
      this.setData({
        rangeLabel: label,
        ...stats
      })
    } catch (err) {
      console.error('加载统计数据失败', err)
      wx.showToast({ title: '加载失败', icon: 'none' })
    } finally {
      wx.hideLoading()
      this.setData({ loading: false })
    }
  }
})
