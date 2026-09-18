// 云函数入口文件
const cloud = require('wx-server-sdk')
cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
})

const db = cloud.database()
const PACKAGING_FEE = 1
const SHOP_NAME = '红星面馆'

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

const getOrderDate = (order) => {
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
  return date
}

const formatDate = (d) => {
  const beijingTime = new Date(d.getTime() + 8 * 60 * 60 * 1000)
  const pad = (n) => (n < 10 ? '0' + n : n)
  return `${beijingTime.getUTCFullYear()}-${pad(beijingTime.getUTCMonth() + 1)}-${pad(beijingTime.getUTCDate())} ${pad(beijingTime.getUTCHours())}:${pad(beijingTime.getUTCMinutes())}`
}

const TAG_PRICE_SUFFIX = /\s\+(\d+(?:\.\d+)?)元$/

const getItemBasePrice = (item) => {
  if (item.basePrice != null && item.basePrice !== '') {
    return Number(item.basePrice) || 0
  }
  const unitPrice = Number(item.price) || 0
  const extraPrice = Number(item.extraPrice) || 0
  return extraPrice > 0 ? Math.max(0, unitPrice - extraPrice) : unitPrice
}

const appendAlignedLine = (leftText, rightPart, fontHeight = 1) => {
  const leftWidth = getStringWidth(leftText)
  const rightWidth = getStringWidth(rightPart)
  const totalWidth = 31
  const spacesNeeded = totalWidth - leftWidth - rightWidth
  const spaces = spacesNeeded > 0 ? generateSpaces(spacesNeeded) : ' '
  return `<LEFT><font# bolder=0 height=${fontHeight} width=1>${leftText}${spaces}${rightPart}</font#></LEFT><BR>`
}

// ticketType: 'front' 前台（含价格） | 'kitchen' 后厨（无价格）
function generatePrintContent(order, ticketType = 'front') {
  const isKitchen = ticketType === 'kitchen'
  const orderTypeText = order.orderType === 'dineIn' ? '堂食' : '打包'
  const date = getOrderDate(order)

  let content = ''
  if (isKitchen) {
    content += `<C><font# bolder=1 height=2 width=2>后厨</font#></C><BR>`
    content += `<C><font# bolder=1 height=2 width=2>${orderTypeText}</font#></C><BR>`
  } else {
    content += `<C><font# bolder=1 height=2 width=2>前台·${orderTypeText}订单</font#></C><BR>`
  }
  content += `<C><font# bolder=1 height=2 width=2>${SHOP_NAME}</font#></C><BR>`
  content += `<C>--------------------------------</C><BR>`
  content += `<LEFT>订单编号: ${escapeHtml(order._id)}</LEFT><BR>`
  content += `<LEFT>下单时间: ${formatDate(date)}</LEFT><BR>`

  if (order.tableNumber) {
    content += `<C><font# bolder=1 height=2 width=2>桌码: ${escapeHtml(order.tableNumber)}</font#></C><BR>`
  }

  if (order.remark) {
    if (isKitchen) {
      content += `<C><font# bolder=1 height=2 width=2>备注: ${escapeHtml(order.remark)}</font#></C><BR>`
    } else {
      content += `<LEFT>备注: ${escapeHtml(order.remark)}</LEFT><BR>`
    }
  }

  content += `<C>--------------商品--------------</C><BR>`

  if (order.goods && order.goods.length > 0) {
    order.goods.forEach(item => {
      const dishName = escapeHtml(item.dishName || item.goodsName || '未知菜品')
      const count = item.count || 1
      const basePrice = getItemBasePrice(item)
      const rightPart = isKitchen
        ? `×${count}`
        : `×${count}  ￥${basePrice.toFixed(2)}`
      content += appendAlignedLine(dishName, rightPart, 2)

      if (item.tags && Array.isArray(item.tags) && item.tags.length > 0) {
        item.tags.forEach(tagStr => {
          const raw = String(tagStr)
          const priceMatch = raw.match(TAG_PRICE_SUFFIX)
          const tagPrice = priceMatch ? parseFloat(priceMatch[1]) : 0
          const tagLabel = escapeHtml(priceMatch ? raw.slice(0, priceMatch.index).trim() : raw)
          if (isKitchen) {
            content += appendAlignedLine(`  ${tagLabel}`, '', 1)
          } else {
            const tagRight = tagPrice > 0 ? `  ￥${tagPrice.toFixed(2)}` : ''
            content += appendAlignedLine(`  ${tagLabel}`, tagRight, 1)
          }
        })
      }
    })
  }

  content += `<C>--------------------------------</C><BR>`
  const packagingFee = Number(order.packagingFee) || 0
  if (packagingFee > 0) {
    if (isKitchen) {
      content += `<LEFT><font# bolder=0 height=2 width=1>打包费</font#></LEFT><BR>`
    } else {
      content += `<RIGHT><font# bolder=0 height=1 width=1>打包费  ￥${packagingFee.toFixed(2)}</font#></RIGHT><BR>`
    }
  }
  if (!isKitchen) {
    const finalPrice = (order.finalPrice || 0).toFixed(2)
    content += `<RIGHT><font# bolder=0 height=1 width=1>合计  ￥${finalPrice}</font#></RIGHT><BR>`
    content += `<LEFT>订单来源: 店员口头点餐</LEFT><BR>`
  }
  content += `<C>**************<font# bolder=1 height=2 width=1>完</font#><font# bolder=0 height=1 width=1>**************</font#></C><BR>`
  return content
}

async function callPrintNote(printer, { content, outTradeNo, voice }) {
  const data = {
    $url: 'printNote',
    sn: printer.sn,
    content,
    copies: 1,
    expiresInSeconds: 7200,
    outTradeNo
  }
  if (voice) {
    data.voice = voice
    data.voicePlayTimes = 1
    data.voicePlayInterval = 3
  }
  return cloud.callFunction({
    name: 'printManage',
    data
  })
}

async function printOrder(orderId, orderData) {
  try {
    const printerRes = await db.collection('printer').limit(1).get()
    if (!printerRes.data || printerRes.data.length === 0) {
      console.log('未绑定打印机，跳过打印')
      return { printed: false, reason: 'no_printer' }
    }

    const printer = printerRes.data[0]
    const voice = orderData.orderType === 'dineIn' ? '16' : '19'

    const kitchenContent = generatePrintContent(orderData, 'kitchen')
    const frontContent = generatePrintContent(orderData, 'front')

    const kitchenRes = await callPrintNote(printer, {
      content: kitchenContent,
      outTradeNo: `${orderId}_kitchen`,
      voice
    })
    const frontRes = await callPrintNote(printer, {
      content: frontContent,
      outTradeNo: `${orderId}_front`
    })

    const kitchenOk = kitchenRes.result && kitchenRes.result.success
    const frontOk = frontRes.result && frontRes.result.success

    if (kitchenOk && frontOk) {
      console.log('打印订单成功（前台+后厨）', { kitchen: kitchenRes.result, front: frontRes.result })
      return { printed: true }
    }

    const failedRes = !kitchenOk ? kitchenRes : frontRes
    const printError = failedRes.result?.error || failedRes.result?.data?.message || '未知错误'
    const reason = !kitchenOk && !frontOk
      ? 'print_failed'
      : !kitchenOk
        ? 'kitchen_print_failed'
        : 'front_print_failed'
    console.error('打印订单失败', { kitchenOk, frontOk, kitchen: kitchenRes.result, front: frontRes.result, printerSn: printer.sn })
    return { printed: false, reason, printError }
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
    tableNumber,
    orderType,
    remark
  } = event

  try {
    const finalOrderType = orderType || (tableNumber ? 'dineIn' : 'takeOut')
    const date = new Date()
    const orderTotal = Number(totalPrice) || 0
    const packagingFee = finalOrderType === 'takeOut' ? PACKAGING_FEE : 0
    const orderFinal = orderTotal + packagingFee

    const orderData = {
      type: 'order',
      goods: orderGoods,
      totalPrice: orderTotal,
      packagingFee,
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
