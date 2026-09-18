// 云函数入口文件
const cloud = require('wx-server-sdk')
cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
})

const db = cloud.database()

// 生成打印内容
function generatePrintContent(order, shopInfo) {
  const orderTypeText = order.orderType === 'dineIn' ? '堂食' : '打包'

  let date = new Date()
  if (order.createTime) {
    if (order.createTime instanceof Date) {
      date = order.createTime
    } else if (typeof order.createTime === 'object' && order.createTime.getTime) {
      date = new Date(order.createTime.getTime())
    } else {
      date = new Date(order.createTime)
    }
  }

  const formatDate = (d) => {
    const beijingTime = new Date(d.getTime() + 8 * 60 * 60 * 1000)
    const pad = (n) => (n < 10 ? '0' + n : n)
    return `${beijingTime.getUTCFullYear()}-${pad(beijingTime.getUTCMonth() + 1)}-${pad(beijingTime.getUTCDate())} ${pad(beijingTime.getUTCHours())}:${pad(beijingTime.getUTCMinutes())}`
  }

  const getStringWidth = (str) => {
    if (!str) return 0
    let width = 0
    for (let i = 0; i < str.length; i++) {
      const char = str.charAt(i)
      if (/[\u4e00-\u9fa5\u3000-\u303f\uff00-\uffef]/.test(char)) {
        width += 2
      } else {
        width += 1
      }
    }
    return width
  }

  const generateSpaces = (count) => ' '.repeat(count)

  const escapeHtml = (str) => {
    if (!str) return ''
    return String(str).replace(/</g, '&lt;').replace(/>/g, '&gt;')
  }

  let content = `<C>*</C><BR>`
  content += `<C></C><BR>`
  content += `<C></C><BR>`
  content += `<C></C><BR>`
  content += `<C></C><BR>`
  content += `<C></C><BR>`
  content += `<C></C><BR>`
  content += `<C></C><BR>`
  content += `<C></C><BR>`
  content += `<C></C><BR>`
  content += `<C></C><BR>`
  content += `<C></C><BR>`
  content += `<C></C><BR>`
  content += `<C></C><BR>`
  content += `<C></C><BR>`
  content += `<C></C><BR>`
  content += `<C></C><BR>`
  content += `<C><font# bolder=1 height=2 width=2>${orderTypeText}订单</font#></C><BR>`
  content += `<C><font# bolder=1 height=2 width=2>${escapeHtml(shopInfo?.name || '老叶原汤手工拉面')}</font#></C><BR>`
  content += `<BR>`

  content += `<C>********************************</C><BR>`
  content += `<LEFT>订单编号: ${escapeHtml(order._id)}</LEFT><BR>`
  content += `<LEFT>下单时间: ${formatDate(date)}</LEFT><BR>`

  if (order.tableNumber) {
    content += `<C><font# bolder=1 height=2 width=2>桌码: ${escapeHtml(order.tableNumber)}</font#></C><BR>`
  }

  if (order.remark) {
    content += `<LEFT>备注: ${escapeHtml(order.remark)}</LEFT><BR>`
  }

  content += `<C>--------------商品--------------</C><BR>`

  if (order.goods && order.goods.length > 0) {
    order.goods.forEach(item => {
      const dishName = escapeHtml(item.dishName || item.goodsName || '未知菜品')
      const count = item.count || 1
      const price = parseFloat(item.price || 0).toFixed(2)
      const rightPart = `×${count}  ￥${price}`
      const dishNameWidth = getStringWidth(dishName)
      const rightPartWidth = getStringWidth(rightPart)
      const totalWidth = 31
      const spacesNeeded = totalWidth - dishNameWidth - rightPartWidth
      const spaces = spacesNeeded > 0 ? generateSpaces(spacesNeeded) : ' '
      content += `<LEFT><font# bolder=0 height=2 width=1>${dishName}${spaces}${rightPart}</font#></LEFT><BR>`

      if (item.tags && Array.isArray(item.tags) && item.tags.length > 0) {
        const tagsText = item.tags.map(tag => escapeHtml(tag)).join(' ')
        content += `<LEFT><font# bolder=0 height=2 width=1>  ${tagsText}</font#></LEFT><BR>`
      }
    })
  }

  const finalPrice = (order.finalPrice || 0).toFixed(2)

  content += `<C>--------------------------------</C><BR>`
  content += `<RIGHT><font# bolder=0 height=2 width=1>合计  ￥${finalPrice}</font#></RIGHT><BR>`
  content += `<LEFT>订单来源: 店员口头点餐</LEFT><BR>`
  content += `<C>--------------------------------</C><BR>`
  content += `<C>**************<font# bolder=1 height=2 width=1>完</font#><font# bolder=0 height=1 width=1>**************</font#></C><BR>`
  content += `<C></C><BR>`
  content += `<C></C><BR>`
  content += `<C></C><BR>`
  content += `<C></C><BR>`
  content += `<C></C><BR>`
  content += `<C></C><BR>`
  content += `<C></C><BR>`
  content += `<C></C><BR>`
  content += `<C></C><BR>`
  content += `<C></C><BR>`
  content += `<C></C><BR>`
  content += `<C></C><BR>`
  content += `<C></C><BR>`
  content += `<C></C><BR>`
  content += `<C></C><BR>`
  return content
}

async function printOrder(orderId, orderData) {
  try {
    const printerRes = await db.collection('printer').limit(1).get()
    if (!printerRes.data || printerRes.data.length === 0) {
      console.log('未绑定打印机，跳过打印')
      return { printed: false, reason: 'no_printer' }
    }

    const printer = printerRes.data[0]
    const shopRes = await db.collection('shopInfo').limit(1).get()
    const shopInfo = shopRes.data && shopRes.data.length > 0 ? shopRes.data[0] : null
    const printContent = generatePrintContent(orderData, shopInfo)
    const voice = orderData.orderType === 'dineIn' ? '16' : '19'

    const printRes = await cloud.callFunction({
      name: 'printManage',
      data: {
        $url: 'printNote',
        sn: printer.sn,
        voice: voice,
        voicePlayTimes: 1,
        voicePlayInterval: 3,
        content: printContent,
        copies: 1,
        expiresInSeconds: 7200,
        outTradeNo: orderId
      }
    })

    if (printRes.result && printRes.result.success) {
      console.log('打印订单成功', printRes.result)
      return { printed: true }
    }

    const printError = printRes.result?.error || printRes.result?.data?.message || '未知错误'
    console.error('打印订单失败', printRes.result, 'printerSn:', printer.sn)
    return { printed: false, reason: 'print_failed', printError }
  } catch (err) {
    console.error('打印订单异常', err)
    return { printed: false, reason: err.message || 'print_error' }
  }
}

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID

  const {
    orderGoods,
    totalPrice,
    finalPrice,
    tableNumber,
    orderType,
    remark
  } = event

  try {
    const finalOrderType = orderType || (tableNumber ? 'dineIn' : 'takeOut')
    const date = new Date()
    const orderTotal = Number(totalPrice) || 0
    const orderFinal = Number(finalPrice) || orderTotal

    const orderData = {
      type: 'order',
      goods: orderGoods,
      totalPrice: orderTotal,
      finalPrice: orderFinal,
      orderType: finalOrderType,
      pay_status: true,
      source: 'staff_verbal',
      remark: remark || '',
      createTime: db.serverDate(),
      _openid: openid,
      tableNumber: tableNumber || ''
    }

    const orderRes = await db.collection('order').add({
      data: orderData
    })

    const orderId = orderRes._id
    const orderWithId = {
      ...orderData,
      _id: orderId,
      createTime: date
    }

    const printResult = await printOrder(orderId, orderWithId)

    return {
      success: true,
      orderId,
      printed: printResult.printed === true,
      printReason: printResult.reason || '',
      printError: printResult.printError || ''
    }
  } catch (err) {
    console.error('下单失败', err)
    return {
      success: false,
      error: err.message || '下单失败'
    }
  }
}
