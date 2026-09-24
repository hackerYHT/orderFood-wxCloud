// pages/admin/dish/dish.js
const db = wx.cloud.database()
const { getCloudImageUrl, resolveCloudImageUrls } = require('../../../utils/cloudImage.js')
const {
  isCategoryRefTag,
  removeTagByKey,
  getTagRemoveKey,
  expandCategoryRefTag,
  collectCategoryIdsFromTags,
  serializeTagsForStorage
} = require('../../../utils/dishTags.js')
const { formatRemoveError } = require('../../../utils/dbError.js')

Page({
  data: {
    // 分类相关
    categories: [],
    currentCategoryId: '', // 当前选中的分类ID
    showCategoryModal: false,
    editCategoryMode: false,
    currentCategory: {
      _id: '',
      name: '',
      sort: 0,
      packagingFee: false
    },
    
    // 菜品相关
    dishes: [],
    showDishModal: false,
    editDishMode: false,
      currentDish: {
        _id: '',
        name: '',
        price: '',
        originalPrice: '',
        description: '',
        categoryId: '',
        categoryName: '',
        image: '',
        status: 1, // 1: 上架, 0: 下架
        sort: 0,
        tags: [], // 标签数组
        canUseMiandan: false // 是否可以参与免单
      },
    
    // 标签编辑
    showTagModal: false,
    editingTagIndex: -1, // -1表示新增，>=0表示编辑
    currentTag: {
      name: '',
      type: 'single', // single: 单选, multiple: 多选
      required: true, // 是否必选
      options: []
    },
    allDishesForOptions: [], // 可作为标签选项的菜品列表
    // 菜品分页
    dishPage: 0,
    dishPageSize: 20,
    dishHasMore: true,
    loadingDishes: false,

    // 复制菜品
    showCopyDishModal: false,
    copySourceDish: null,
    copyTargetCategoryId: '',
    copyCategoryIndex: 0
  },

  onLoad() {
    this.loadCategories()
    this.loadDishes()
    this.loadAllDishesForOptions()
  },

  goToTagBatch() {
    wx.navigateTo({
      url: '/pages/admin/tagBatch/tagBatch'
    })
  },

  onShow() {
    this.loadCategories()
    this.loadDishes()
    this.loadAllDishesForOptions()
  },

  // ==================== 分类管理 ====================
  
  // 加载分类列表（直连数据库，避免云函数冷启动/超时）
  async loadCategories() {
    try {
      const res = await db.collection('dishCategory').orderBy('sort', 'asc').get()
      const categories = res.data || []
      const currentCategoryId = this.data.currentCategoryId
      const hasValidCategory = categories.some(item => item._id === currentCategoryId)

      // 无选中分类，或当前分类已被删除时，默认选中第一个
      if (categories.length > 0 && (!currentCategoryId || !hasValidCategory)) {
        this.setData({
          categories,
          currentCategoryId: categories[0]._id
        }, () => {
          this.loadDishes()
        })
      } else {
        this.setData({
          categories,
          currentCategoryId: categories.length === 0 ? '' : currentCategoryId
        }, () => {
          if (this.data.currentCategoryId) {
            this.loadDishes()
          } else {
            this.setData({ dishes: [] })
          }
        })
      }
    } catch (err) {
      console.error('加载分类失败', err)
    }
  },

  // 切换分类
  switchCategory(e) {
    const categoryId = e.currentTarget.dataset.id
    this.setData({
      currentCategoryId: categoryId
    }, () => {
      this.loadDishes()
    })
  },

  // 显示添加分类弹窗
  showAddCategoryModal() {
    this.setData({
      showCategoryModal: true,
      editCategoryMode: false,
      currentCategory: {
        _id: '',
        name: '',
        sort: this.data.categories.length,
        packagingFee: false
      }
    })
  },

  // 显示编辑分类弹窗
  showEditCategoryModal(e) {
    const category = e.currentTarget.dataset.category
    this.setData({
      showCategoryModal: true,
      editCategoryMode: true,
      currentCategory: {
        ...category,
        packagingFee: category.packagingFee === true
      }
    })
  },

  // 关闭分类弹窗
  closeCategoryModal() {
    this.setData({
      showCategoryModal: false
    })
  },

  // 输入分类名称
  onCategoryNameInput(e) {
    this.setData({
      'currentCategory.name': e.detail.value
    })
  },

  // 输入分类排序
  onCategorySortInput(e) {
    this.setData({
      'currentCategory.sort': parseInt(e.detail.value) || 0
    })
  },

  onCategoryPackagingFeeChange(e) {
    this.setData({
      'currentCategory.packagingFee': e.detail.value
    })
  },

  // 保存分类
  async saveCategory() {
    const { editCategoryMode, currentCategory } = this.data

    if (!currentCategory.name.trim()) {
      wx.showToast({
        title: '请输入分类名称',
        icon: 'none'
      })
      return
    }

    try {
      wx.showLoading({ title: '保存中...' })

      if (editCategoryMode) {
        // 编辑
        const { _id, _openid, ...updateData } = currentCategory
        updateData.packagingFee = currentCategory.packagingFee === true
        await db.collection('dishCategory').doc(_id).update({
          data: updateData
        })
      } else {
        // 添加
        const addRes = await db.collection('dishCategory').add({
          data: {
            name: currentCategory.name,
            sort: currentCategory.sort,
            packagingFee: currentCategory.packagingFee === true,
            createTime: new Date()
          }
        })
        
        // 添加后自动选中新分类
        this.setData({
          currentCategoryId: addRes._id
        })
      }

      wx.hideLoading()
      wx.showToast({
        title: '保存成功',
        icon: 'success'
      })

      this.closeCategoryModal()
      this.loadCategories()
    } catch (err) {
      wx.hideLoading()
      console.error('保存失败', err)
      wx.showToast({
        title: '保存失败',
        icon: 'none'
      })
    }
  },

  resolveDatasetId(e, objectKey = '') {
    const dataset = e.currentTarget.dataset || {}
    if (dataset.id) return dataset.id
    if (objectKey && dataset[objectKey] && dataset[objectKey]._id) {
      return dataset[objectKey]._id
    }
    return ''
  },

  async fetchDocument(collectionName, docId) {
    if (!docId) return null
    try {
      const res = await db.collection(collectionName).doc(docId).get()
      return res.data || null
    } catch (err) {
      const message = (err && err.errMsg) || ''
      if (message.includes('cannot find document') || message.includes('document.get:fail')) {
        return null
      }
      throw err
    }
  },

  async removeDishTagReferences(dishId) {
    if (!dishId) return

    const pageSize = 20
    let page = 0
    let hasMore = true

    while (hasMore) {
      const res = await db.collection('dish')
        .skip(page * pageSize)
        .limit(pageSize)
        .get()
      const list = res.data || []

      for (const dish of list) {
        if (!dish.tags || !dish.tags.length) continue

        let changed = false
        const tags = dish.tags.map(tag => {
          const options = (tag.options || []).filter(option => {
            const optionDishId = this.getOptionDishId(option)
            if (optionDishId === dishId) {
              changed = true
              return false
            }
            return true
          })
          return { ...tag, options }
        })

        if (changed) {
          await db.collection('dish').doc(dish._id).update({ data: { tags } })
        }
      }

      hasMore = list.length === pageSize
      page += 1
    }
  },

  async removeCategoryRefTags(categoryId) {
    if (!categoryId) return

    const removeKey = getTagRemoveKey({ categoryId, source: 'categoryRef' })
    const pageSize = 20
    let page = 0
    let hasMore = true

    while (hasMore) {
      const res = await db.collection('dish')
        .skip(page * pageSize)
        .limit(pageSize)
        .get()
      const list = res.data || []

      for (const dish of list) {
        const currentTags = Array.isArray(dish.tags) ? dish.tags : []
        const nextTags = removeTagByKey(currentTags, removeKey)
        if (nextTags.length === currentTags.length) continue

        await db.collection('dish').doc(dish._id).update({
          data: { tags: nextTags }
        })
      }

      hasMore = list.length === pageSize
      page += 1
    }
  },

  async deleteDishViaCloud(dishId) {
    const res = await wx.cloud.callFunction({
      name: 'deleteDish',
      data: { dishId }
    })
    const result = res.result || {}
    if (!result.success) {
      const error = new Error(result.message || '删除菜品失败')
      error.code = result.code
      throw error
    }
    return result
  },

  async deleteCategoryViaCloud(categoryId) {
    const res = await wx.cloud.callFunction({
      name: 'deleteCategory',
      data: { categoryId }
    })
    const result = res.result || {}
    if (!result.success) {
      const error = new Error(result.message || '删除分类失败')
      error.code = result.code
      throw error
    }
    return result
  },

  async removeDishesInCategory(categoryId) {
    const pageSize = 20
    let hasMore = true

    while (hasMore) {
      const res = await db.collection('dish')
        .where({ categoryId })
        .limit(pageSize)
        .get()
      const list = res.data || []

      for (const dish of list) {
        await this.deleteDishViaCloud(dish._id)
      }

      hasMore = list.length === pageSize
    }
  },

  // 删除分类
  async deleteCategory(e) {
    const categoryId = this.resolveDatasetId(e, 'category')
    const categoryName = e.currentTarget.dataset.name
      || (e.currentTarget.dataset.category || {}).name
      || '该分类'

    if (!categoryId) {
      wx.showToast({
        title: '分类信息无效，请刷新后重试',
        icon: 'none'
      })
      return
    }

    let dishCount = 0
    try {
      const countRes = await db.collection('dish').where({ categoryId }).count()
      dishCount = countRes.total || 0
    } catch (err) {
      console.error('统计分类菜品失败', err)
      wx.showToast({
        title: '无法统计分类下菜品，请稍后重试',
        icon: 'none'
      })
      return
    }

    wx.showModal({
      title: '确认删除',
      content: dishCount > 0
        ? `分类「${categoryName}」下有 ${dishCount} 个菜品，删除分类将同时删除这些菜品，并清理其他菜品中的分类标签引用，是否继续？`
        : `确定要删除分类「${categoryName}」吗？将同时清理其他菜品中的分类标签引用。`,
      success: async (res) => {
        if (!res.confirm) return

        try {
          wx.showLoading({ title: '删除中...' })

          const categoryDoc = await this.fetchDocument('dishCategory', categoryId)
          if (!categoryDoc) {
            wx.hideLoading()
            wx.showToast({
              title: '分类已不存在，已刷新列表',
              icon: 'none'
            })
            this.loadCategories()
            return
          }

          const deleteResult = await this.deleteCategoryViaCloud(categoryId)

          wx.hideLoading()
          const softDeleted = deleteResult.dishesSoftDeleted || 0
          wx.showToast({
            title: softDeleted > 0 ? '分类已删除（部分菜品已标记删除）' : '删除成功',
            icon: 'success'
          })

          if (this.data.currentCategoryId === categoryId) {
            this.setData({
              currentCategoryId: '',
              dishes: []
            })
          }

          this.loadCategories()
          this.loadAllDishesForOptions()
        } catch (err) {
          wx.hideLoading()
          console.error('删除分类失败', categoryId, err)
          const message = (err && err.code === 'NOT_FOUND')
            ? '分类已不存在，已刷新列表'
            : formatRemoveError(err, '分类')
          wx.showToast({
            title: message,
            icon: 'none'
          })
          if (err && (err.code === 'NOT_FOUND' || err.code === 'REMOVE_FAILED')) {
            this.loadCategories()
          }
        }
      }
    })
  },

  // ==================== 菜品管理 ====================

  // 加载菜品
  async loadDishes(append = false) {
    if (!this.data.currentCategoryId) {
      this.setData({
        dishes: []
      })
      return
    }

    try {
      if (this.data.loadingDishes) {
        return
      }
      this.setData({ loadingDishes: true })

      const pageSize = this.data.dishPageSize
      const page = append ? this.data.dishPage + 1 : 0
      const skip = page * pageSize

      const res = await db.collection('dish')
        .where({
          categoryId: this.data.currentCategoryId
        })
        .orderBy('sort', 'asc')
        .skip(skip)
        .limit(pageSize)
        .get()
      
      const list = (res.data || []).filter(item => item.deleted !== true)
      const mergedDishes = append ? this.data.dishes.concat(list) : list
      const newDishes = await resolveCloudImageUrls(mergedDishes)
      const hasMore = list.length === pageSize

      this.setData({
        dishes: newDishes,
        dishPage: page,
        dishHasMore: hasMore
      })
    } catch (err) {
      console.error('加载菜品失败', err)
      wx.showToast({
        title: '加载失败',
        icon: 'none'
      })
    } finally {
      this.setData({ loadingDishes: false })
    }
  },

  // 滚动到底部时加载更多菜品
  loadMoreDishes() {
    if (this.data.dishHasMore && !this.data.loadingDishes && this.data.currentCategoryId) {
      this.loadDishes(true)
    }
  },

  // 加载全部菜品，用于配置“已有菜品作为标签选项”
  async loadAllDishesForOptions() {
    try {
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
        const list = (res.data || []).filter(item => item.deleted !== true)
        allDishes = allDishes.concat(list)
        hasMore = list.length === pageSize
        page += 1
      }

      const resolvedDishes = await resolveCloudImageUrls(allDishes)
      this.setData({
        allDishesForOptions: this.buildOptionDishList(resolvedDishes, this.data.currentTag.options)
      })
    } catch (err) {
      console.error('加载标签选项菜品失败', err)
    }
  },

  buildOptionDishList(dishes, selectedOptions = []) {
    const selectedDishIds = selectedOptions.map(option => this.getOptionDishId(option)).filter(Boolean)
    const currentDishId = this.data.currentDish && this.data.currentDish._id

    return (dishes || []).map(dish => ({
      _id: dish._id,
      name: dish.name,
      price: Number(dish.price) || 0,
      image: dish.image || '',
      imageUrl: dish.imageUrl || dish.image || '',
      categoryName: dish.categoryName || '',
      optionSelected: selectedDishIds.includes(dish._id),
      optionDisabled: !!currentDishId && dish._id === currentDishId
    }))
  },

  getOptionDishId(option) {
    if (!option) return ''
    if (typeof option === 'string') return ''
    return option.dishId || option._id || ''
  },

  async propagateDishToTagOptions(dishId, dishInfo) {
    if (!dishId) return

    const name = dishInfo.name || ''
    const price = Number(dishInfo.price) || 0
    const image = dishInfo.image || ''
    const pageSize = 20
    let page = 0
    let hasMore = true

    while (hasMore) {
      const res = await db.collection('dish')
        .skip(page * pageSize)
        .limit(pageSize)
        .get()
      const list = res.data || []

      for (const dish of list) {
        if (!dish.tags || !dish.tags.length) continue

        let changed = false
        const tags = dish.tags.map(tag => {
          const options = (tag.options || []).map(option => {
            const optionDishId = this.getOptionDishId(option)
            if (optionDishId !== dishId) return option
            changed = true
            if (typeof option === 'string') return option
            return {
              ...option,
              dishId: optionDishId,
              name,
              price,
              image
            }
          })
          return { ...tag, options }
        })

        if (changed) {
          await db.collection('dish').doc(dish._id).update({ data: { tags } })
        }
      }

      hasMore = list.length === pageSize
      page += 1
    }
  },

  normalizeTagOptions(options = []) {
    return options.map(option => {
      if (typeof option === 'string') {
        return {
          name: option,
          price: 0,
          image: '',
          defaultSelected: false
        }
      }
      return {
        dishId: option.dishId || option._id || '',
        name: option.name || option.dishName || '',
        price: Number(option.price) || 0,
        image: option.image || option.dishImage || '',
        defaultSelected: option.defaultSelected === true
      }
    })
  },

  normalizeDefaultOptionsForTag(tag) {
    const nextTag = {
      ...tag,
      options: this.normalizeTagOptions(tag.options || [])
    }

    if (nextTag.type === 'single') {
      let hasDefault = false
      nextTag.options = nextTag.options.map(option => {
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

    return nextTag
  },

  // 显示添加菜品弹窗
  showAddDishModal() {
    if (!this.data.currentCategoryId) {
      wx.showToast({
        title: '请先选择分类',
        icon: 'none'
      })
      return
    }

    const currentCategory = this.data.categories.find(c => c._id === this.data.currentCategoryId)

    this.setData({
      showDishModal: true,
      editDishMode: false,
      currentDish: {
        _id: '',
        name: '',
        price: '',
        originalPrice: '',
        description: '',
        categoryId: this.data.currentCategoryId,
        categoryName: currentCategory ? currentCategory.name : '',
        image: '',
        status: 1,
        sort: this.data.dishes.length,
        tags: [],
        canUseMiandan: false // 是否可以参与免单
      }
    })
  },

  async loadCategoryDishesMap(categoryIds = []) {
    const uniqueIds = [...new Set((categoryIds || []).filter(Boolean))]
    const map = {}

    await Promise.all(uniqueIds.map(async categoryId => {
      const pageSize = 20
      let page = 0
      let dishes = []
      let hasMore = true

      while (hasMore) {
        const res = await db.collection('dish')
          .where({
            categoryId,
            status: 1
          })
          .orderBy('sort', 'asc')
          .skip(page * pageSize)
          .limit(pageSize)
          .get()
        const list = res.data || []
        dishes = dishes.concat(list)
        hasMore = list.length === pageSize
        page += 1
      }

      map[categoryId] = dishes
    }))

    return map
  },

  async expandDishTagsForPreview(dish) {
    const categoryIds = collectCategoryIdsFromTags(dish.tags || [])
    const categoryDishesMap = categoryIds.length
      ? await this.loadCategoryDishesMap(categoryIds)
      : {}

    return {
      ...dish,
      tags: (dish.tags || []).map(tag => expandCategoryRefTag(tag, categoryDishesMap))
    }
  },

  // 显示编辑菜品弹窗
  async showEditDishModal(e) {
    const dish = e.currentTarget.dataset.dish
    const imageUrl = await getCloudImageUrl(dish.image)
    const previewDish = await this.expandDishTagsForPreview(dish)
    this.setData({
      showDishModal: true,
      editDishMode: true,
      currentDish: {
        ...previewDish,
        imageUrl: imageUrl || dish.image || ''
      }
    })
  },

  // 关闭菜品弹窗
  closeDishModal() {
    this.setData({
      showDishModal: false
    })
  },

  // 切换菜品上下架状态
  async toggleDishStatus(e) {
    const dish = e.currentTarget.dataset.dish
    const newStatus = dish.status === 1 ? 0 : 1

    try {
      await db.collection('dish').doc(dish._id).update({
        data: {
          status: newStatus
        }
      })

      wx.showToast({
        title: newStatus === 1 ? '已上架' : '已下架',
        icon: 'success'
      })

      this.loadDishes()
    } catch (err) {
      console.error('切换状态失败', err)
      wx.showToast({
        title: '操作失败',
        icon: 'none'
      })
    }
  },

  // 输入菜品名称
  onDishNameInput(e) {
    let value = e.detail.value
    // 限制最多10个字
    if (value.length > 10) {
      value = value.substring(0, 10)
      wx.showToast({
        title: '名称最多10个字',
        icon: 'none'
      })
    }
    this.setData({
      'currentDish.name': value
    })
  },

  // 输入菜品价格
  onDishPriceInput(e) {
    let value = e.detail.value
    if (isNaN(value)) {
      value = ''
    } else {
      // 不能为负数，最高10000
      if (value < 0) {
        value = 0
        wx.showToast({
          title: '价格不能为负数',
          icon: 'none'
        })
      } else if (value > 10000) {
        value = 10000
        wx.showToast({
          title: '价格最高10000',
          icon: 'none'
        })
      }
    }
    this.setData({
      'currentDish.price': value
    })
  },

  // 输入菜品原价
  onDishOriginalPriceInput(e) {
    let value = e.detail.value
    if (isNaN(value)) {
      value = ''
    } else {
      // 不能为负数，最高10000
      if (value < 0) {
        value = 0
        wx.showToast({
          title: '价格不能为负数',
          icon: 'none'
        })
      } else if (value > 10000) {
        value = 10000
        wx.showToast({
          title: '价格最高10000',
          icon: 'none'
        })
      }
    }
    this.setData({
      'currentDish.originalPrice': value
    })
  },

  // 输入菜品描述
  onDishDescriptionInput(e) {
    let value = e.detail.value
    // 限制最多10个字
    if (value.length > 10) {
      value = value.substring(0, 10)
      wx.showToast({
        title: '描述最多10个字',
        icon: 'none'
      })
    }
    this.setData({
      'currentDish.description': value
    })
  },

  // 输入菜品排序
  onDishSortInput(e) {
    this.setData({
      'currentDish.sort': parseInt(e.detail.value) || 0
    })
  },

  // 切换可参与免单
  onCanUseMiandanChange(e) {
    this.setData({
      'currentDish.canUseMiandan': e.detail.value
    })
  },

  // 选择菜品图片
  async chooseDishImage() {
    try {
      const res = await wx.chooseImage({
        count: 1,
        sizeType: ['compressed'],
        sourceType: ['album', 'camera']
      })

      const tempFilePath = res.tempFilePaths[0]

      wx.showLoading({ title: '上传中...' })

      const cloudPath = `dish/${Date.now()}_${Math.random().toString(36).substr(2)}.jpg`
      const uploadRes = await wx.cloud.uploadFile({
        cloudPath,
        filePath: tempFilePath
      })

      wx.hideLoading()

      const imageUrl = await getCloudImageUrl(uploadRes.fileID)
      this.setData({
        'currentDish.image': uploadRes.fileID,
        'currentDish.imageUrl': imageUrl || uploadRes.fileID
      })

      wx.showToast({
        title: '上传成功',
        icon: 'success'
      })
    } catch (err) {
      wx.hideLoading()
      console.error('上传图片失败', err)
      wx.showToast({
        title: '上传失败',
        icon: 'none'
      })
    }
  },

  // 保存菜品
  async saveDish() {
    const { editDishMode, currentDish } = this.data

    // 验证必填项：图片
    if (!currentDish.image || !currentDish.image.trim()) {
      wx.showToast({
        title: '请上传菜品图片',
        icon: 'none'
      })
      return
    }

    // 验证必填项：名称
    if (!currentDish.name || !currentDish.name.trim()) {
      wx.showToast({
        title: '请输入菜品名称',
        icon: 'none'
      })
      return
    }

    // 验证名称字数（最多10个字）
    if (currentDish.name.trim().length > 10) {
      wx.showToast({
        title: '菜品名称最多10个字',
        icon: 'none'
      })
      return
    }

    // 验证描述字数（最多10个字）
    if (currentDish.description && currentDish.description.trim().length > 10) {
      wx.showToast({
        title: '菜品描述最多10个字',
        icon: 'none'
      })
      return
    }

    // 验证必填项：分类
    if (!currentDish.categoryId) {
      wx.showToast({
        title: '请选择分类',
        icon: 'none'
      })
      return
    }

    // 验证价格：不能为空、不能为负数、最高10000
    const price = parseFloat(currentDish.price)
    if (isNaN(price) || price === '' || price === null || price === undefined) {
      wx.showToast({
        title: '请输入售价',
        icon: 'none'
      })
      return
    }

    if (price < 0) {
      wx.showToast({
        title: '售价不能为负数',
        icon: 'none'
      })
      return
    }

    if (price > 10000) {
      wx.showToast({
        title: '售价最高10000',
        icon: 'none'
      })
      return
    }

    // 验证必填项：原价
    const originalPrice = parseFloat(currentDish.originalPrice)
    if (isNaN(originalPrice) || originalPrice === '' || originalPrice === null || originalPrice === undefined) {
      wx.showToast({
        title: '请输入原价',
        icon: 'none'
      })
      return
    }

    if (originalPrice < 0) {
      wx.showToast({
        title: '原价不能为负数',
        icon: 'none'
      })
      return
    }

    if (originalPrice > 10000) {
      wx.showToast({
        title: '原价最高10000',
        icon: 'none'
      })
      return
    }

    // 验证原价不能小于售价
    if (originalPrice < price) {
      wx.showToast({
        title: '原价不能小于售价',
        icon: 'none'
      })
      return
    }

    try {
      wx.showLoading({ title: '保存中...' })
      const { _id, _openid, imageUrl, ...updateData } = currentDish
      // 确保价格和原价是数字类型
      updateData.price = price
      updateData.originalPrice = originalPrice
      updateData.tags = serializeTagsForStorage(updateData.tags)
      
      if (editDishMode) {
        // 编辑（去掉 _id 和 _openid 等系统字段）
        
        await db.collection('dish').doc(_id).update({
          data: updateData
        })
        await this.propagateDishToTagOptions(_id, {
          name: updateData.name,
          price: updateData.price,
          image: updateData.image
        })
      } else {
        // 添加
        await db.collection('dish').add({
          data: {
            ...updateData,
            createTime: new Date()
          }
        })
      }

      wx.hideLoading()
      wx.showToast({
        title: '保存成功',
        icon: 'success'
      })

      this.closeDishModal()
      this.loadDishes()
      this.loadAllDishesForOptions()
    } catch (err) {
      wx.hideLoading()
      console.error('保存失败', err)
      wx.showToast({
        title: '保存失败',
        icon: 'none'
      })
    }
  },

  // 显示复制菜品弹窗
  showCopyDishModal(e) {
    const dish = e.currentTarget.dataset.dish
    const categoryIndex = this.data.categories.findIndex(c => c._id === this.data.currentCategoryId)
    this.setData({
      showCopyDishModal: true,
      copySourceDish: dish,
      copyTargetCategoryId: this.data.currentCategoryId,
      copyCategoryIndex: categoryIndex >= 0 ? categoryIndex : 0
    })
  },

  closeCopyDishModal() {
    this.setData({
      showCopyDishModal: false
    })
  },

  onCopyCategoryChange(e) {
    const index = parseInt(e.detail.value, 10)
    const category = this.data.categories[index]
    this.setData({
      copyCategoryIndex: index,
      copyTargetCategoryId: category ? category._id : ''
    })
  },

  buildCopyDishName(sourceName) {
    const suffix = '副本'
    const baseName = sourceName || ''
    if (baseName.length + suffix.length <= 10) {
      return baseName + suffix
    }
    return baseName.substring(0, 10 - suffix.length) + suffix
  },

  async confirmCopyDish() {
    const { copySourceDish, copyTargetCategoryId, categories } = this.data

    if (!copySourceDish) return

    if (!copyTargetCategoryId) {
      wx.showToast({
        title: '请选择目标分类',
        icon: 'none'
      })
      return
    }

    const targetCategory = categories.find(c => c._id === copyTargetCategoryId)
    const { _id, _openid, ...sourceData } = copySourceDish

    const newDishData = {
      ...sourceData,
      name: this.buildCopyDishName(sourceData.name),
      categoryId: copyTargetCategoryId,
      categoryName: targetCategory ? targetCategory.name : '',
      tags: JSON.parse(JSON.stringify(sourceData.tags || [])),
      createTime: new Date()
    }

    try {
      wx.showLoading({ title: '复制中...' })

      const addRes = await db.collection('dish').add({
        data: newDishData
      })

      wx.hideLoading()
      this.closeCopyDishModal()

      const newDish = {
        ...newDishData,
        _id: addRes._id
      }

      if (copyTargetCategoryId !== this.data.currentCategoryId) {
        this.setData({
          currentCategoryId: copyTargetCategoryId
        }, () => {
          this.loadDishes()
        })
      } else {
        this.loadDishes()
      }
      this.loadAllDishesForOptions()

      const imageUrl = await getCloudImageUrl(newDish.image)
      this.setData({
        showDishModal: true,
        editDishMode: true,
        currentDish: {
          ...newDish,
          imageUrl: imageUrl || newDish.image || ''
        }
      })

      wx.showToast({
        title: '复制成功，请修改名称',
        icon: 'success'
      })
    } catch (err) {
      wx.hideLoading()
      console.error('复制失败', err)
      wx.showToast({
        title: '复制失败',
        icon: 'none'
      })
    }
  },

  // 删除菜品
  deleteDish(e) {
    const dishId = this.resolveDatasetId(e, 'dish')
    const dishName = e.currentTarget.dataset.name
      || (e.currentTarget.dataset.dish || {}).name
      || '该菜品'

    if (!dishId) {
      wx.showToast({
        title: '菜品信息无效，请刷新后重试',
        icon: 'none'
      })
      return
    }

    wx.showModal({
      title: '确认删除',
      content: `确定要删除菜品「${dishName}」吗？`,
      success: async (res) => {
        if (!res.confirm) return

        try {
          wx.showLoading({ title: '删除中...' })

          const dishDoc = await this.fetchDocument('dish', dishId)
          if (!dishDoc || dishDoc.deleted === true) {
            wx.hideLoading()
            wx.showToast({
              title: '菜品已不存在，已刷新列表',
              icon: 'none'
            })
            this.loadDishes()
            this.loadAllDishesForOptions()
            return
          }

          const deleteResult = await this.deleteDishViaCloud(dishId)

          wx.hideLoading()
          wx.showToast({
            title: deleteResult.mode === 'soft' ? '已标记删除' : '删除成功',
            icon: 'success'
          })

          this.loadDishes()
          this.loadAllDishesForOptions()
        } catch (err) {
          wx.hideLoading()
          console.error('删除菜品失败', dishId, err)
          const message = (err && err.code === 'NOT_FOUND')
            ? '菜品已不存在，已刷新列表'
            : formatRemoveError(err, '菜品')
          wx.showToast({
            title: message,
            icon: 'none'
          })
          if (err && err.code === 'NOT_FOUND') {
            this.loadDishes()
            this.loadAllDishesForOptions()
          }
        }
      }
    })
  },

  // ==================== 标签管理 ====================

  // 显示添加标签弹窗
  showAddTagModal() {
    const currentTag = {
      name: '',
      type: 'single',
      required: true,
      options: []
    }
    this.setData({
      showTagModal: true,
      editingTagIndex: -1,
      currentTag,
      allDishesForOptions: this.buildOptionDishList(this.data.allDishesForOptions, currentTag.options)
    })
  },

  // 显示编辑标签弹窗
  async showEditTagModal(e) {
    const index = e.currentTarget.dataset.index
    const tag = this.data.currentDish.tags[index]

    if (isCategoryRefTag(tag)) {
      wx.showToast({
        title: '分类动态标签请在「标签批量」中管理',
        icon: 'none'
      })
      return
    }

    const normalizedOptions = this.normalizeTagOptions(tag.options || [])
    const options = await Promise.all(normalizedOptions.map(async option => ({
      ...option,
      imageUrl: await getCloudImageUrl(option.image)
    })))
    const currentTag = {
      ...JSON.parse(JSON.stringify(tag)),
      options
    }
    this.setData({
      showTagModal: true,
      editingTagIndex: index,
      currentTag,
      allDishesForOptions: this.buildOptionDishList(this.data.allDishesForOptions, currentTag.options)
    })
  },

  // 关闭标签弹窗
  closeTagModal() {
    this.setData({
      showTagModal: false
    })
  },

  // 输入标签名称
  onTagNameInput(e) {
    this.setData({
      'currentTag.name': e.detail.value
    })
  },

  // 选择标签类型
  selectTagType(e) {
    const type = e.currentTarget.dataset.type
    const currentTag = this.normalizeDefaultOptionsForTag({
      ...this.data.currentTag,
      type
    })
    this.setData({ currentTag })
  },

  // 切换是否必选
  onTagRequiredChange(e) {
    this.setData({
      'currentTag.required': e.detail.value
    })
  },

  // 批量设置标签是否必选
  batchSetTagsRequired(e) {
    const raw = e.currentTarget.dataset.required
    const required = raw === true || raw === 'true'
    const { currentDish } = this.data

    if (!currentDish.tags || currentDish.tags.length === 0) {
      return
    }

    const tags = currentDish.tags.map(tag => ({
      ...tag,
      required
    }))

    this.setData({
      'currentDish.tags': tags
    })

    wx.showToast({
      title: required ? '已全部设为必选' : '已全部设为非必选',
      icon: 'success'
    })
  },

  // 勾选/取消已有菜品作为标签选项
  toggleOptionDish(e) {
    const dish = e.currentTarget.dataset.dish || {}
    const dishId = e.currentTarget.dataset.id || dish._id || dish.dishId || ''
    if (!dishId || dish.optionDisabled) return

    const currentTag = JSON.parse(JSON.stringify(this.data.currentTag))
    const options = this.normalizeTagOptions(currentTag.options || [])
    const index = options.findIndex(option => this.getOptionDishId(option) === dishId)

    if (index > -1) {
      options.splice(index, 1)
    } else {
      options.push({
        dishId,
        name: dish.name,
        price: Number(dish.price) || 0,
        image: dish.image || '',
        imageUrl: dish.imageUrl || dish.image || '',
        defaultSelected: false
      })
    }

    currentTag.options = options
    this.setData({
      currentTag,
      allDishesForOptions: this.buildOptionDishList(this.data.allDishesForOptions, options)
    })
  },

  // 切换标签选项是否默认选中
  toggleDefaultOption(e) {
    const index = e.currentTarget.dataset.index
    const currentTag = JSON.parse(JSON.stringify(this.data.currentTag))
    const options = this.normalizeTagOptions(currentTag.options || [])
    const option = options[index]

    if (!option) return

    const nextDefaultSelected = !option.defaultSelected
    if (currentTag.type === 'single' && nextDefaultSelected) {
      options.forEach(item => {
        item.defaultSelected = false
      })
    }
    options[index].defaultSelected = nextDefaultSelected
    currentTag.options = options

    this.setData({ currentTag })
  },

  // 删除选项
  deleteOption(e) {
    const index = parseInt(e.currentTarget.dataset.index, 10)
    if (Number.isNaN(index)) return

    const currentTag = JSON.parse(JSON.stringify(this.data.currentTag))
    currentTag.options.splice(index, 1)
    this.setData({
      currentTag,
      allDishesForOptions: this.buildOptionDishList(this.data.allDishesForOptions, currentTag.options)
    })
  },

  // 保存标签
  saveTag() {
    const { currentTag, editingTagIndex, currentDish } = this.data

    if (!currentTag.name.trim()) {
      wx.showToast({
        title: '请输入标签名称',
        icon: 'none'
      })
      return
    }

    const normalizedTag = this.normalizeDefaultOptionsForTag(currentTag)
    currentTag.options = normalizedTag.options

    if (!isCategoryRefTag(currentTag) && currentTag.options.length === 0) {
      wx.showToast({
        title: '请至少选择一个菜品',
        icon: 'none'
      })
      return
    }

    if (editingTagIndex === -1) {
      // 新增
      currentDish.tags.push({
        id: Date.now().toString(),
        ...currentTag
      })
    } else {
      // 编辑
      currentDish.tags[editingTagIndex] = {
        id: currentDish.tags[editingTagIndex].id,
        ...currentTag
      }
    }

    this.setData({
      currentDish,
      showTagModal: false
    })
  },

  // 删除标签
  deleteTag(e) {
    const index = e.currentTarget.dataset.index
    const { currentDish } = this.data

    wx.showModal({
      title: '确认删除',
      content: '确定要删除这个标签吗？',
      success: (res) => {
        if (res.confirm) {
          currentDish.tags.splice(index, 1)
          this.setData({
            currentDish
          })
        }
      }
    })
  },

  // 阻止冒泡
  stopPropagation() {}
})
