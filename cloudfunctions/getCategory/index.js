// 云函数入口文件
const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()

const DISH_PAGE_SIZE = 100

async function fetchOnShelfDishes() {
  const dishes = []
  let page = 0
  let hasMore = true

  while (hasMore) {
    const res = await db.collection('dish')
      .where({ status: 1 })
      .field({
        categoryId: true,
        categoryName: true
      })
      .skip(page * DISH_PAGE_SIZE)
      .limit(DISH_PAGE_SIZE)
      .get()

    const list = (res.data || []).filter(item => item.deleted !== true)
    dishes.push(...list)
    hasMore = list.length === DISH_PAGE_SIZE
    page += 1
  }

  return dishes
}

function buildCategoriesFromDishes(dishes = []) {
  const categoryMap = new Map()

  dishes.forEach((dish, index) => {
    const categoryId = dish.categoryId || `__uncategorized__${dish.categoryName || 'default'}`
    if (categoryMap.has(categoryId)) {
      return
    }

    categoryMap.set(categoryId, {
      _id: categoryId,
      name: dish.categoryName || '未分类',
      sort: index,
      synthetic: true
    })
  })

  return [...categoryMap.values()].sort((a, b) => a.sort - b.sort)
}

function mergeOrphanCategories(categories = [], dishes = []) {
  const existingIds = new Set(categories.map(item => item._id))
  const orphanCategories = []

  dishes.forEach(dish => {
    const categoryId = dish.categoryId
    if (!categoryId || existingIds.has(categoryId)) {
      return
    }

    existingIds.add(categoryId)
    orphanCategories.push({
      _id: categoryId,
      name: dish.categoryName || '未分类',
      sort: 9000 + orphanCategories.length,
      synthetic: true
    })
  })

  if (!orphanCategories.length) {
    return categories
  }

  return categories.concat(orphanCategories).sort((a, b) => {
    const sortA = typeof a.sort === 'number' ? a.sort : 0
    const sortB = typeof b.sort === 'number' ? b.sort : 0
    return sortA - sortB
  })
}

// 云函数入口函数
exports.main = async (event, context) => {
  try {
    const menuRes = await db.collection('dishCategory')
      .orderBy('sort', 'asc')
      .limit(100)
      .get()

    let categories = menuRes.data || []
    const onShelfDishes = await fetchOnShelfDishes()

    if (categories.length === 0 && onShelfDishes.length > 0) {
      categories = buildCategoriesFromDishes(onShelfDishes)
    } else if (categories.length > 0 && onShelfDishes.length > 0) {
      categories = mergeOrphanCategories(categories, onShelfDishes)
    }

    return {
      success: true,
      data: categories
    }
  } catch (err) {
    console.error('获取菜品分类失败', err)
    return {
      success: false,
      message: '获取菜品分类失败'
    }
  }
}
