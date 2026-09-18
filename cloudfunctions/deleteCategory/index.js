// 云函数：服务端删除分类，绕过客户端「仅创建者可写」权限限制
const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()

function getOptionDishId(option) {
  if (!option) return ''
  if (typeof option === 'string') return ''
  return option.dishId || option._id || ''
}

function isCategoryRefTag(tag) {
  if (!tag) return false
  return tag.source === 'categoryRef' || !!tag.categoryId
}

function getCategoryRefRemoveKey(categoryId) {
  return `categoryRef:${categoryId}`
}

function tagsMatchRemoveKey(tag, removeKey) {
  if (!tag) return false
  if (isCategoryRefTag(tag)) {
    return `categoryRef:${tag.categoryId || tag.name || ''}` === removeKey
  }
  return `name:${(tag.name || '').trim()}` === removeKey
}

function removeTagByKey(tags = [], removeKey) {
  return tags.filter(tag => !tagsMatchRemoveKey(tag, removeKey))
}

async function removeDishTagReferences(dishId) {
  if (!dishId) return 0

  const pageSize = 100
  let page = 0
  let hasMore = true
  let updatedCount = 0

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
          const optionDishId = getOptionDishId(option)
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
        updatedCount += 1
      }
    }

    hasMore = list.length === pageSize
    page += 1
  }

  return updatedCount
}

async function hardDeleteDish(dishId) {
  const removeRes = await db.collection('dish').doc(dishId).remove()
  const removed = removeRes && removeRes.stats ? removeRes.stats.removed : 0
  if (removed === 0) {
    throw new Error('hard delete returned 0 removed')
  }
  return removed
}

async function softDeleteDish(dishId) {
  await db.collection('dish').doc(dishId).update({
    data: {
      status: 0,
      deleted: true,
      deletedAt: db.serverDate()
    }
  })
}

async function deleteDishById(dishId) {
  const refsUpdated = await removeDishTagReferences(dishId)

  try {
    await hardDeleteDish(dishId)
    return { mode: 'hard', refsUpdated }
  } catch (removeErr) {
    console.warn('hard delete dish failed, fallback to soft delete', dishId, removeErr)
    await softDeleteDish(dishId)
    return { mode: 'soft', refsUpdated }
  }
}

async function removeDishesInCategory(categoryId) {
  const pageSize = 100
  let hasMore = true
  let deletedCount = 0
  let softDeletedCount = 0

  while (hasMore) {
    const res = await db.collection('dish')
      .where({ categoryId })
      .limit(pageSize)
      .get()
    const list = (res.data || []).filter(item => item.deleted !== true)

    for (const dish of list) {
      const result = await deleteDishById(dish._id)
      deletedCount += 1
      if (result.mode === 'soft') {
        softDeletedCount += 1
      }
    }

    hasMore = list.length === pageSize
  }

  return { deletedCount, softDeletedCount }
}

async function removeCategoryRefTags(categoryId) {
  if (!categoryId) return 0

  const removeKey = getCategoryRefRemoveKey(categoryId)
  const pageSize = 100
  let page = 0
  let hasMore = true
  let updatedCount = 0

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
      updatedCount += 1
    }

    hasMore = list.length === pageSize
    page += 1
  }

  return updatedCount
}

exports.main = async (event) => {
  const categoryId = event && event.categoryId ? String(event.categoryId).trim() : ''

  if (!categoryId) {
    return {
      success: false,
      message: '缺少分类 ID'
    }
  }

  try {
    let categoryDoc = null
    try {
      const categoryRes = await db.collection('dishCategory').doc(categoryId).get()
      categoryDoc = categoryRes.data || null
    } catch (getErr) {
      const message = (getErr && getErr.message) || ''
      if (!message.includes('cannot find document') && !message.includes('document.get:fail')) {
        throw getErr
      }
    }

    if (!categoryDoc) {
      return {
        success: false,
        code: 'NOT_FOUND',
        message: '分类不存在或已被删除'
      }
    }

    const countRes = await db.collection('dish').where({ categoryId }).count()
    const dishCount = countRes.total || 0

    const dishDeleteResult = dishCount > 0
      ? await removeDishesInCategory(categoryId)
      : { deletedCount: 0, softDeletedCount: 0 }

    const refsUpdated = await removeCategoryRefTags(categoryId)

    const removeRes = await db.collection('dishCategory').doc(categoryId).remove()
    const removed = removeRes && removeRes.stats ? removeRes.stats.removed : 0
    if (removed === 0) {
      return {
        success: false,
        code: 'REMOVE_FAILED',
        message: '分类删除失败：记录不存在或无法删除'
      }
    }

    return {
      success: true,
      categoryId,
      dishCount,
      dishesDeleted: dishDeleteResult.deletedCount,
      dishesSoftDeleted: dishDeleteResult.softDeletedCount,
      refsUpdated
    }
  } catch (err) {
    console.error('deleteCategory cloud function failed', categoryId, err)
    return {
      success: false,
      categoryId,
      message: (err && err.message) || '删除分类失败'
    }
  }
}
