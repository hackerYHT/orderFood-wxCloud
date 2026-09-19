// pages/admin/tagBatch/tagBatch.js
const db = wx.cloud.database()
const {
  isCategoryRefTag,
  buildCategoryRefTag,
  getTagRemoveKey,
  getTagDisplayLabel,
  mergeTagIntoDish,
  removeTagByKey,
  applyBatchDefaultToTag
} = require('../../../utils/dishTags.js')

Page({
  data: {
    activeTab: 'dishes',
    loading: false,
    categories: [],
    filterCategoryOptions: ['全部'],
    filterCategoryId: '',
    filterCategoryIndex: 0,
    allDishes: [],
    displayDishes: [],
    selectedDishIds: [],
    selectAll: false,

    tagStats: [],
    selectedTagName: '',
    showEditModal: false,
    batchSettings: {
      required: true,
      type: 'single'
    },
    affectedDishes: [],
    applying: false,

    showAddCategoryTagModal: false,
    addTagForm: {
      categoryIndex: 0,
      categoryId: '',
      name: '',
      type: 'single',
      required: true
    },

    showRemoveTagModal: false,
    removableTags: [],
    selectedRemoveKey: '',

    showDefaultModal: false,
    defaultOptionCandidates: [],
    selectedDefaultKey: '',
    defaultApplyScope: 'all'
  },

  onLoad() {
    this.loadPageData()
  },

  onShow() {
    this.loadPageData()
  },

  switchTab(e) {
    const tab = e.currentTarget.dataset.tab
    this.setData({ activeTab: tab })
  },

  async loadPageData() {
    if (this.data.loading) return

    this.setData({ loading: true })

    try {
      const [categories, allDishes] = await Promise.all([
        this.fetchCategories(),
        this.fetchAllDishes()
      ])
      const tagStats = this.buildTagStats(allDishes)
      const filterCategoryId = this.data.filterCategoryId || ''
      const filterCategoryIndex = filterCategoryId
        ? categories.findIndex(item => item._id === filterCategoryId) + 1
        : 0

      this.setData({
        categories,
        filterCategoryOptions: ['全部', ...categories.map(item => item.name)],
        allDishes,
        filterCategoryId,
        filterCategoryIndex: filterCategoryIndex >= 0 ? filterCategoryIndex : 0,
        tagStats
      }, () => {
        this.refreshDisplayDishes()
      })
    } catch (err) {
      console.error('加载数据失败', err)
      wx.showToast({
        title: '加载失败',
        icon: 'none'
      })
    } finally {
      this.setData({ loading: false })
    }
  },

  async fetchCategories() {
    const res = await wx.cloud.callFunction({
      name: 'getCategory'
    })
    const result = res.result || {}
    return result.success ? (result.data || []) : []
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

  refreshDisplayDishes() {
    const { allDishes, filterCategoryId, selectedDishIds } = this.data
    const displayDishes = allDishes
      .filter(dish => !filterCategoryId || dish.categoryId === filterCategoryId)
      .map(dish => ({
        ...dish,
        selected: selectedDishIds.includes(dish._id),
        tagCount: (dish.tags || []).length
      }))
    const visibleIds = displayDishes.map(item => item._id)
    const selectedVisibleCount = visibleIds.filter(id => selectedDishIds.includes(id)).length

    this.setData({
      displayDishes,
      selectAll: visibleIds.length > 0 && selectedVisibleCount === visibleIds.length
    })
  },

  onFilterCategoryChange(e) {
    const index = parseInt(e.detail.value, 10)
    const category = index > 0 ? this.data.categories[index - 1] : null
    this.setData({
      filterCategoryIndex: index,
      filterCategoryId: category ? category._id : ''
    }, () => {
      this.refreshDisplayDishes()
    })
  },

  toggleDishSelect(e) {
    const dishId = e.currentTarget.dataset.id
    const selectedDishIds = [...this.data.selectedDishIds]
    const index = selectedDishIds.indexOf(dishId)

    if (index > -1) {
      selectedDishIds.splice(index, 1)
    } else {
      selectedDishIds.push(dishId)
    }

    this.setData({ selectedDishIds }, () => {
      this.refreshDisplayDishes()
    })
  },

  toggleSelectAll() {
    const { displayDishes, selectAll, selectedDishIds } = this.data
    const visibleIds = displayDishes.map(item => item._id)
    let nextSelected = [...selectedDishIds]

    if (selectAll) {
      nextSelected = nextSelected.filter(id => !visibleIds.includes(id))
    } else {
      visibleIds.forEach(id => {
        if (!nextSelected.includes(id)) {
          nextSelected.push(id)
        }
      })
    }

    this.setData({ selectedDishIds: nextSelected }, () => {
      this.refreshDisplayDishes()
    })
  },

  clearSelection() {
    this.setData({ selectedDishIds: [] }, () => {
      this.refreshDisplayDishes()
    })
  },

  buildTagStats(dishes) {
    const tagMap = {}

    dishes.forEach(dish => {
      (dish.tags || []).forEach(tag => {
        const removeKey = getTagRemoveKey(tag)
        if (!removeKey) return

        if (!tagMap[removeKey]) {
          tagMap[removeKey] = {
            removeKey,
            name: getTagDisplayLabel(tag),
            rawName: tag.name || '',
            isCategoryRef: isCategoryRefTag(tag),
            categoryId: tag.categoryId || '',
            dishCount: 0,
            requiredCount: 0,
            singleCount: 0,
            multipleCount: 0,
            dishes: []
          }
        }

        const stat = tagMap[removeKey]
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

  buildRemovableTagsFromSelection() {
    const selectedSet = new Set(this.data.selectedDishIds)
    const tagMap = {}

    this.data.allDishes.forEach(dish => {
      if (!selectedSet.has(dish._id)) return
      ;(dish.tags || []).forEach(tag => {
        const removeKey = getTagRemoveKey(tag)
        if (!removeKey) return
        if (!tagMap[removeKey]) {
          tagMap[removeKey] = {
            removeKey,
            label: getTagDisplayLabel(tag),
            count: 0
          }
        }
        tagMap[removeKey].count += 1
      })
    })

    return Object.values(tagMap).sort((a, b) => b.count - a.count)
  },

  openAddCategoryTagModal() {
    if (this.data.selectedDishIds.length === 0) {
      wx.showToast({
        title: '请先选择菜品',
        icon: 'none'
      })
      return
    }

    const { categories } = this.data
    const categoryIndex = 0
    const category = categories[categoryIndex]

    this.setData({
      showAddCategoryTagModal: true,
      addTagForm: {
        categoryIndex,
        categoryId: category ? category._id : '',
        name: category ? category.name : '',
        type: 'single',
        required: true
      }
    })
  },

  closeAddCategoryTagModal() {
    this.setData({ showAddCategoryTagModal: false })
  },

  onAddTagCategoryChange(e) {
    const index = parseInt(e.detail.value, 10)
    const category = this.data.categories[index]
    this.setData({
      'addTagForm.categoryIndex': index,
      'addTagForm.categoryId': category ? category._id : '',
      'addTagForm.name': category ? category.name : ''
    })
  },

  onAddTagNameInput(e) {
    this.setData({
      'addTagForm.name': e.detail.value
    })
  },

  setAddTagRequired(e) {
    const raw = e.currentTarget.dataset.required
    const required = raw === true || raw === 'true'
    this.setData({
      'addTagForm.required': required
    })
  },

  selectAddTagType(e) {
    const type = e.currentTarget.dataset.type
    this.setData({
      'addTagForm.type': type
    })
  },

  async confirmAddCategoryTag() {
    const { selectedDishIds, addTagForm, applying } = this.data
    if (!selectedDishIds.length || applying) return

    const category = this.data.categories[addTagForm.categoryIndex]
    if (!category || !category._id) {
      wx.showToast({
        title: '请选择分类',
        icon: 'none'
      })
      return
    }

    const tagName = (addTagForm.name || category.name || '').trim()
    if (!tagName) {
      wx.showToast({
        title: '请输入标签名称',
        icon: 'none'
      })
      return
    }

    const newTag = buildCategoryRefTag({
      categoryId: category._id,
      categoryName: category.name,
      name: tagName,
      type: addTagForm.type,
      required: addTagForm.required
    })

    wx.showModal({
      title: '确认添加分类标签',
      content: `将为 ${selectedDishIds.length} 个菜品添加「${tagName}」标签，选项将动态引用「${category.name}」分类下的菜品`,
      success: async (res) => {
        if (!res.confirm) return
        await this.applyTagsToSelectedDishes(selectedDishIds, newTag, 'add')
      }
    })
  },

  openRemoveTagModal() {
    if (this.data.selectedDishIds.length === 0) {
      wx.showToast({
        title: '请先选择菜品',
        icon: 'none'
      })
      return
    }

    const removableTags = this.buildRemovableTagsFromSelection()
    if (!removableTags.length) {
      wx.showToast({
        title: '所选菜品暂无标签',
        icon: 'none'
      })
      return
    }

    this.setData({
      showRemoveTagModal: true,
      removableTags,
      selectedRemoveKey: removableTags[0].removeKey
    })
  },

  closeRemoveTagModal() {
    this.setData({ showRemoveTagModal: false })
  },

  selectRemoveTag(e) {
    const removeKey = e.currentTarget.dataset.key
    this.setData({ selectedRemoveKey: removeKey })
  },

  async confirmRemoveTag() {
    const { selectedDishIds, selectedRemoveKey, applying } = this.data
    if (!selectedDishIds.length || !selectedRemoveKey || applying) return

    const targetTag = this.data.removableTags.find(item => item.removeKey === selectedRemoveKey)
    const label = targetTag ? targetTag.label : '所选标签'

    wx.showModal({
      title: '确认移除标签',
      content: `将从 ${selectedDishIds.length} 个菜品中移除「${label}」`,
      success: async (res) => {
        if (!res.confirm) return
        await this.applyTagsToSelectedDishes(selectedDishIds, selectedRemoveKey, 'remove')
      }
    })
  },

  async applyTagsToSelectedDishes(dishIds, payload, mode) {
    this.setData({ applying: true })
    wx.showLoading({ title: mode === 'add' ? '添加中...' : '移除中...' })

    let successCount = 0
    let failCount = 0

    try {
      for (const dishId of dishIds) {
        try {
          const dishRes = await db.collection('dish').doc(dishId).get()
          const dish = dishRes.data
          if (!dish) {
            failCount += 1
            continue
          }

          const currentTags = Array.isArray(dish.tags) ? dish.tags : []
          const nextTags = mode === 'add'
            ? mergeTagIntoDish(currentTags, payload)
            : removeTagByKey(currentTags, payload)

          if (JSON.stringify(currentTags) === JSON.stringify(nextTags)) {
            continue
          }

          await db.collection('dish').doc(dishId).update({
            data: { tags: nextTags }
          })
          successCount += 1
        } catch (err) {
          console.error('更新菜品标签失败', dishId, err)
          failCount += 1
        }
      }

      wx.hideLoading()

      if (failCount === 0) {
        wx.showToast({
          title: mode === 'add'
            ? `已更新 ${successCount} 个菜品`
            : `已移除 ${successCount} 个菜品标签`,
          icon: 'success'
        })
      } else {
        wx.showToast({
          title: `成功 ${successCount}，失败 ${failCount}`,
          icon: 'none'
        })
      }

      if (mode === 'add') {
        this.closeAddCategoryTagModal()
      } else {
        this.closeRemoveTagModal()
      }

      await this.loadPageData()
    } catch (err) {
      wx.hideLoading()
      console.error('批量操作失败', err)
      wx.showToast({
        title: '操作失败',
        icon: 'none'
      })
    } finally {
      this.setData({ applying: false })
    }
  },

  openBatchEdit(e) {
    const removeKey = e.currentTarget.dataset.key
    const stat = this.data.tagStats.find(item => item.removeKey === removeKey)
    if (!stat || stat.dishes.length === 0) return

    const firstTag = stat.dishes[0].tag || {}

    this.setData({
      selectedTagName: stat.name,
      showEditModal: true,
      affectedDishes: stat.dishes,
      batchSettings: {
        required: firstTag.required !== false,
        type: firstTag.type === 'multiple' ? 'multiple' : 'single'
      },
      selectedRemoveKey: removeKey
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

    if (updated.type === 'single' && Array.isArray(updated.options) && !isCategoryRefTag(updated)) {
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
    const { selectedRemoveKey, batchSettings, affectedDishes, applying } = this.data

    if (!selectedRemoveKey || affectedDishes.length === 0 || applying) {
      return
    }

    const requiredText = batchSettings.required ? '必选' : '非必选'
    const typeText = batchSettings.type === 'multiple' ? '多选' : '单选'

    wx.showModal({
      title: '确认批量更新',
      content: `将 ${affectedDishes.length} 个菜品中的「${this.data.selectedTagName}」标签统一设为：${requiredText}、${typeText}`,
      success: async (res) => {
        if (!res.confirm) return
        await this.doBatchUpdate()
      }
    })
  },

  buildDefaultOptionCandidates(stat) {
    if (!stat) return []

    const optionMap = {}

    if (stat.isCategoryRef && stat.categoryId) {
      this.data.allDishes
        .filter(dish => dish.categoryId === stat.categoryId && dish.deleted !== true)
        .forEach(dish => {
          const key = dish._id
          optionMap[key] = {
            key,
            dishId: dish._id,
            name: dish.name || '',
            label: dish.name || ''
          }
        })
    } else {
      stat.dishes.forEach(item => {
        const tag = item.tag || {}
        ;(tag.options || []).forEach(option => {
          if (typeof option === 'string') {
            const name = option.trim()
            if (!name) return
            const key = `name:${name}`
            if (!optionMap[key]) {
              optionMap[key] = {
                key,
                dishId: '',
                name,
                label: name
              }
            }
            return
          }

          const dishId = option.dishId || option._id || ''
          const name = option.name || option.dishName || ''
          const key = dishId || `name:${name}`
          if (!key || optionMap[key]) return

          optionMap[key] = {
            key,
            dishId,
            name,
            label: name
          }
        })
      })
    }

    return Object.values(optionMap).sort((a, b) => a.label.localeCompare(b.label, 'zh-CN'))
  },

  getCurrentDefaultKey(stat) {
    if (!stat || !stat.dishes.length) return ''

    const firstTag = stat.dishes[0].tag || {}
    const defaultOption = (firstTag.options || []).find(option => option && option.defaultSelected === true)
    if (!defaultOption) return ''

    if (typeof defaultOption === 'string') {
      return `name:${defaultOption}`
    }

    const dishId = defaultOption.dishId || defaultOption._id || ''
    if (dishId) return dishId
    const name = defaultOption.name || defaultOption.dishName || ''
    return name ? `name:${name}` : ''
  },

  openDefaultEdit(e) {
    const removeKey = e.currentTarget.dataset.key
    const stat = this.data.tagStats.find(item => item.removeKey === removeKey)
    if (!stat || stat.dishes.length === 0) return

    const defaultOptionCandidates = this.buildDefaultOptionCandidates(stat)
    if (!defaultOptionCandidates.length) {
      wx.showToast({
        title: '该标签暂无可用选项',
        icon: 'none'
      })
      return
    }

    const currentDefaultKey = this.getCurrentDefaultKey(stat)
    const hasSelectedDishes = this.data.selectedDishIds.length > 0

    this.setData({
      selectedTagName: stat.name,
      showDefaultModal: true,
      affectedDishes: stat.dishes,
      defaultOptionCandidates,
      selectedDefaultKey: currentDefaultKey || defaultOptionCandidates[0].key,
      selectedRemoveKey: removeKey,
      defaultApplyScope: hasSelectedDishes ? 'selected' : 'all'
    })
  },

  closeDefaultModal() {
    this.setData({ showDefaultModal: false })
  },

  selectDefaultOption(e) {
    const key = e.currentTarget.dataset.key
    this.setData({ selectedDefaultKey: key })
  },

  setDefaultApplyScope(e) {
    const scope = e.currentTarget.dataset.scope
    this.setData({ defaultApplyScope: scope })
  },

  getDefaultTargetDishes(stat) {
    const { defaultApplyScope, selectedDishIds } = this.data
    if (defaultApplyScope === 'selected' && selectedDishIds.length > 0) {
      const selectedSet = new Set(selectedDishIds)
      return stat.dishes.filter(item => selectedSet.has(item._id))
    }
    return stat.dishes
  },

  applyBatchDefault() {
    const { selectedRemoveKey, selectedDefaultKey, defaultOptionCandidates, applying } = this.data
    const stat = this.data.tagStats.find(item => item.removeKey === selectedRemoveKey)

    if (!stat || !selectedDefaultKey || applying) return

    const defaultCandidate = defaultOptionCandidates.find(item => item.key === selectedDefaultKey)
    if (!defaultCandidate) return

    const targetDishes = this.getDefaultTargetDishes(stat)
    if (!targetDishes.length) {
      wx.showToast({
        title: '没有可更新的菜品',
        icon: 'none'
      })
      return
    }

    wx.showModal({
      title: '确认批量设默认',
      content: `将为 ${targetDishes.length} 个菜品中的「${this.data.selectedTagName}」标签设置默认选项「${defaultCandidate.label}」`,
      success: async (res) => {
        if (!res.confirm) return
        await this.doBatchDefaultUpdate(defaultCandidate, false)
      }
    })
  },

  clearBatchDefault() {
    const { selectedRemoveKey, applying } = this.data
    const stat = this.data.tagStats.find(item => item.removeKey === selectedRemoveKey)
    if (!stat || applying) return

    const targetDishes = this.getDefaultTargetDishes(stat)
    if (!targetDishes.length) {
      wx.showToast({
        title: '没有可更新的菜品',
        icon: 'none'
      })
      return
    }

    wx.showModal({
      title: '确认清除默认',
      content: `将清除 ${targetDishes.length} 个菜品中「${this.data.selectedTagName}」标签的默认选项`,
      success: async (res) => {
        if (!res.confirm) return
        await this.doBatchDefaultUpdate(null, true)
      }
    })
  },

  async doBatchDefaultUpdate(defaultCandidate, clearDefault = false) {
    const { selectedRemoveKey } = this.data
    const stat = this.data.tagStats.find(item => item.removeKey === selectedRemoveKey)
    if (!stat) return

    const targetDishes = this.getDefaultTargetDishes(stat)
    this.setData({ applying: true })
    wx.showLoading({ title: '更新中...' })

    let successCount = 0
    let failCount = 0

    try {
      for (const item of targetDishes) {
        try {
          const dishRes = await db.collection('dish').doc(item._id).get()
          const dish = dishRes.data
          if (!dish || !Array.isArray(dish.tags)) {
            failCount += 1
            continue
          }

          let changed = false
          const tags = dish.tags.map(tag => {
            if (getTagRemoveKey(tag) !== selectedRemoveKey) {
              return tag
            }
            changed = true
            return applyBatchDefaultToTag(tag, defaultCandidate, clearDefault)
          })

          if (!changed) {
            continue
          }

          await db.collection('dish').doc(item._id).update({
            data: { tags }
          })
          successCount += 1
        } catch (err) {
          console.error('更新默认选项失败', item._id, err)
          failCount += 1
        }
      }

      wx.hideLoading()

      if (failCount === 0) {
        wx.showToast({
          title: clearDefault
            ? `已清除 ${successCount} 个菜品默认`
            : `已更新 ${successCount} 个菜品`,
          icon: 'success'
        })
      } else {
        wx.showToast({
          title: `成功 ${successCount}，失败 ${failCount}`,
          icon: 'none'
        })
      }

      this.closeDefaultModal()
      await this.loadPageData()
    } catch (err) {
      wx.hideLoading()
      console.error('批量设置默认失败', err)
      wx.showToast({
        title: '更新失败',
        icon: 'none'
      })
    } finally {
      this.setData({ applying: false })
    }
  },

  async doBatchUpdate() {
    const { selectedRemoveKey, batchSettings, affectedDishes } = this.data

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
            if (getTagRemoveKey(tag) !== selectedRemoveKey) {
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
      await this.loadPageData()
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
