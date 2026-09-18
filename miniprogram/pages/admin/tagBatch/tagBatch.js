// pages/admin/tagBatch/tagBatch.js
const db = wx.cloud.database()

Page({
  data: {
    loading: false,
    tagStats: [],
    selectedTagName: '',
    showEditModal: false,
    batchSettings: {
      required: true,
      type: 'single'
    },
    affectedDishes: [],
    applying: false
  },

  onLoad() {
    this.loadAllDishesAndTags()
  },

  onShow() {
    this.loadAllDishesAndTags()
  },

  async loadAllDishesAndTags() {
    if (this.data.loading) return

    this.setData({ loading: true })

    try {
      const allDishes = await this.fetchAllDishes()
      const tagStats = this.buildTagStats(allDishes)
      this.setData({ tagStats })
    } catch (err) {
      console.error('加载标签数据失败', err)
      wx.showToast({
        title: '加载失败',
        icon: 'none'
      })
    } finally {
      this.setData({ loading: false })
    }
  },

  async fetchAllDishes() {
    const pageSize = 20
    let page = 0
    let allDishes = []
    let hasMore = true

    while (hasMore) {
      const res = await db.collection('dish')
        .orderBy('sort', 'asc')
        .skip(page * pageSize)
        .limit(pageSize)
        .get()
      const list = res.data || []
      allDishes = allDishes.concat(list)
      hasMore = list.length === pageSize
      page += 1
    }

    return allDishes
  },

  buildTagStats(dishes) {
    const tagMap = {}

    dishes.forEach(dish => {
      (dish.tags || []).forEach(tag => {
        const name = (tag.name || '').trim()
        if (!name) return

        if (!tagMap[name]) {
          tagMap[name] = {
            name,
            dishCount: 0,
            requiredCount: 0,
            singleCount: 0,
            multipleCount: 0,
            dishes: []
          }
        }

        const stat = tagMap[name]
        stat.dishCount += 1
        if (tag.required) stat.requiredCount += 1
        if (tag.type === 'multiple') stat.multipleCount += 1
        else stat.singleCount += 1
        stat.dishes.push({
          _id: dish._id,
          dishName: dish.name,
          categoryName: dish.categoryName || '',
          tag
        })
      })
    })

    return Object.values(tagMap).sort((a, b) => b.dishCount - a.dishCount)
  },

  openBatchEdit(e) {
    const name = e.currentTarget.dataset.name
    const stat = this.data.tagStats.find(item => item.name === name)
    if (!stat || stat.dishes.length === 0) return

    const firstTag = stat.dishes[0].tag || {}

    this.setData({
      selectedTagName: name,
      showEditModal: true,
      affectedDishes: stat.dishes,
      batchSettings: {
        required: firstTag.required !== false,
        type: firstTag.type === 'multiple' ? 'multiple' : 'single'
      }
    })
  },

  closeEditModal() {
    this.setData({
      showEditModal: false
    })
  },

  onRequiredChange(e) {
    this.setData({
      'batchSettings.required': e.detail.value
    })
  },

  setBatchRequired(e) {
    const raw = e.currentTarget.dataset.required
    const required = raw === true || raw === 'true'
    this.setData({
      'batchSettings.required': required
    })
  },

  selectType(e) {
    const type = e.currentTarget.dataset.type
    this.setData({
      'batchSettings.type': type
    })
  },

  normalizeTagForBatch(tag, settings) {
    const updated = {
      ...tag,
      required: settings.required,
      type: settings.type
    }

    if (updated.type === 'single' && Array.isArray(updated.options)) {
      let hasDefault = false
      updated.options = updated.options.map(option => {
        if (option.defaultSelected && !hasDefault) {
          hasDefault = true
          return option
        }
        return {
          ...option,
          defaultSelected: false
        }
      })
    }

    return updated
  },

  async applyBatchUpdate() {
    const { selectedTagName, batchSettings, affectedDishes, applying } = this.data

    if (!selectedTagName || affectedDishes.length === 0 || applying) {
      return
    }

    const requiredText = batchSettings.required ? '必选' : '非必选'
    const typeText = batchSettings.type === 'multiple' ? '多选' : '单选'

    wx.showModal({
      title: '确认批量更新',
      content: `将 ${affectedDishes.length} 个菜品中的「${selectedTagName}」标签统一设为：${requiredText}、${typeText}`,
      success: async (res) => {
        if (!res.confirm) return
        await this.doBatchUpdate()
      }
    })
  },

  async doBatchUpdate() {
    const { selectedTagName, batchSettings, affectedDishes } = this.data

    this.setData({ applying: true })
    wx.showLoading({ title: '更新中...' })

    let successCount = 0
    let failCount = 0

    try {
      for (const item of affectedDishes) {
        try {
          const dishRes = await db.collection('dish').doc(item._id).get()
          const dish = dishRes.data
          if (!dish || !Array.isArray(dish.tags)) {
            failCount += 1
            continue
          }

          let changed = false
          const tags = dish.tags.map(tag => {
            if ((tag.name || '').trim() !== selectedTagName) {
              return tag
            }
            changed = true
            return this.normalizeTagForBatch(tag, batchSettings)
          })

          if (!changed) {
            continue
          }

          await db.collection('dish').doc(item._id).update({
            data: { tags }
          })
          successCount += 1
        } catch (err) {
          console.error('更新菜品标签失败', item._id, err)
          failCount += 1
        }
      }

      wx.hideLoading()

      if (failCount === 0) {
        wx.showToast({
          title: `已更新 ${successCount} 个菜品`,
          icon: 'success'
        })
      } else {
        wx.showToast({
          title: `成功 ${successCount}，失败 ${failCount}`,
          icon: 'none'
        })
      }

      this.closeEditModal()
      this.loadAllDishesAndTags()
    } catch (err) {
      wx.hideLoading()
      console.error('批量更新失败', err)
      wx.showToast({
        title: '更新失败',
        icon: 'none'
      })
    } finally {
      this.setData({ applying: false })
    }
  },

  stopPropagation() {}
})
