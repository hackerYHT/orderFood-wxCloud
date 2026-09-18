// 云函数：服务端删除菜品，绕过客户端「仅创建者可写」权限限制
const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()

function getOptionDishId(option) {
  if (!option) return ''
  if (typeof option === 'string') return ''
  return option.dishId || option._id || ''
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

exports.main = async (event) => {
  const dishId = event && event.dishId ? String(event.dishId).trim() : ''

  if (!dishId) {
    return {
      success: false,
      message: '缺少菜品 ID'
    }
  }

  try {
    let dishDoc = null
    try {
      const dishRes = await db.collection('dish').doc(dishId).get()
      dishDoc = dishRes.data || null
    } catch (getErr) {
      const message = (getErr && getErr.message) || ''
      if (!message.includes('cannot find document') && !message.includes('document.get:fail')) {
        throw getErr
      }
    }

    if (!dishDoc) {
      return {
        success: false,
        code: 'NOT_FOUND',
        message: '菜品不存在或已被删除'
      }
    }

    const refsUpdated = await removeDishTagReferences(dishId)

    try {
      await hardDeleteDish(dishId)
      return {
        success: true,
        dishId,
        mode: 'hard',
        refsUpdated
      }
    } catch (removeErr) {
      console.warn('hard delete failed, fallback to soft delete', dishId, removeErr)
      await softDeleteDish(dishId)
      return {
        success: true,
        dishId,
        mode: 'soft',
        refsUpdated,
        message: '已标记为删除（软删除）'
      }
    }
  } catch (err) {
    console.error('deleteDish cloud function failed', dishId, err)
    return {
      success: false,
      dishId,
      message: (err && err.message) || '删除菜品失败'
    }
  }
}
