// 云函数入口文件
const cloud = require('wx-server-sdk')
cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
})

const db = cloud.database()
const PACKAGING_FEE = 1

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

const getBeijingDateKey = (date = new Date()) => {
  const beijingTime = new Date(date.getTime() + 8 * 60 * 60 * 1000)
  const pad = (n) => (n < 10 ? '0' + n : n)
  return `${beijingTime.getUTCFullYear()}-${pad(beijingTime.getUTCMonth() + 1)}-${pad(beijingTime.getUTCDate())}`
}

const formatQueueNumber = (seq) => String(seq).padStart(3, '0')

const isMissingDocError = (err) => {
  const msg = String((err && err.message) || err || '')
  return msg.includes('does not exist') || msg.includes('document.get:fail')
}

async function getNextQueueNumber() {
  const queueDate = getBeijingDateKey()
  // 计数器文档存放在已有 order 集合，避免单独创建 queueCounter 集合
  const counterId = `queueCounter_${queueDate}`

  const result = await db.runTransaction(async (transaction) => {
    const counterRef = transaction.collection('order').doc(counterId)
    let docRes = null

    try {
      docRes = await counterRef.get()
    } catch (err) {
      // 当天首单时计数器文档尚不存在，get 会抛错而非返回空 data
      if (!isMissingDocError(err)) {
        throw err
      }
    }

    if (docRes && docRes.data) {
      const seq = (docRes.data.seq || 0) + 1
      await counterRef.update({
        data: { seq }
      })
      return seq
    }

    await counterRef.set({
      data: { type: 'queueCounter', seq: 1, queueDate }
    })
    return 1
  })

  return {
    queueDate,
    queueNumber: formatQueueNumber(result)
  }
}

const TAG_PRICE_SUFFIX = /\s\+(\d+(?:\.\d+)?)元$/

// 打印字体：菜品加高但不加宽，避免 58mm 纸一行装不下名称+数量+价格
const FONT_DISH_HEIGHT = 2
const FONT_DISH_WIDTH = 1
const FONT_TAG_HEIGHT = 2
const FONT_TAG_WIDTH = 1

const getItemBasePrice = (item) => {
  if (item.basePrice != null && item.basePrice !== '') {
    return Number(item.basePrice) || 0
  }
  const unitPrice = Number(item.price) || 0
  const extraPrice = Number(item.extraPrice) || 0
  return extraPrice > 0 ? Math.max(0, unitPrice - extraPrice) : unitPrice
}

const appendAlignedLine = (leftText, rightPart, fontHeight = 1, fontWidth = fontHeight) => {
  const leftWidth = getStringWidth(leftText)
  const rightWidth = getStringWidth(rightPart)
  // 58mm 纸约 32 半角；font width 放大后可用列宽需折算
  const totalWidth = Math.floor(31 / fontWidth)
  const spacesNeeded = totalWidth - leftWidth - rightWidth
  const spaces = spacesNeeded > 0 ? generateSpaces(spacesNeeded) : ' '
  return `<LEFT><font# bolder=0 height=${fontHeight} width=${fontWidth}>${leftText}${spaces}${rightPart}</font#></LEFT><BR>`
}

// ticketType: 'front' 前台（含价格） | 'kitchen' 后厨（无价格）
function generatePrintContent(order, ticketType = 'front') {
  const date = getOrderDate(order)

  let content = ''
  if (order.queueNumber) {
    content += `<C><font# bolder=1 height=2 width=2>取餐号</font#></C><BR>`
    content += `<C><font# bolder=1 height=3 width=2>#${escapeHtml(order.queueNumber)}</font#></C><BR>`
    content += `<C>--------------------------------</C><BR>`
  }

  if (order.tableNumber) {
    content += `<C><font# bolder=1 height=2 width=2>桌码: ${escapeHtml(order.tableNumber)}</font#></C><BR>`
  }

  if (order.remark) {
    content += `<C><font# bolder=1 height=2 width=2>备注: ${escapeHtml(order.remark)}</font#></C><BR>`
  }

  content += `<C>--------------商品--------------</C><BR>`

  if (order.goods && order.goods.length > 0) {
    order.goods.forEach(item => {
      const dishName = escapeHtml(item.dishName || item.goodsName || '未知菜品')
      const count = item.count || 1
      const basePrice = getItemBasePrice(item)
      const rightPart = `×${count}  ￥${basePrice.toFixed(2)}`
      content += appendAlignedLine(dishName, rightPart, FONT_DISH_HEIGHT, FONT_DISH_WIDTH)

      if (item.tags && Array.isArray(item.tags) && item.tags.length > 0) {
        item.tags.forEach(tagStr => {
          const raw = String(tagStr)
          const priceMatch = raw.match(TAG_PRICE_SUFFIX)
          const tagPrice = priceMatch ? parseFloat(priceMatch[1]) : 0
          const tagLabel = escapeHtml(priceMatch ? raw.slice(0, priceMatch.index).trim() : raw)
          const tagRight = tagPrice > 0 ? `  ￥${tagPrice.toFixed(2)}` : ''
          content += appendAlignedLine(`  ${tagLabel}`, tagRight, FONT_TAG_HEIGHT, FONT_TAG_WIDTH)
        })
      }
    })
  }

  content += `<C>--------------------------------</C><BR>`
  const packagingFee = Number(order.packagingFee) || 0
  if (packagingFee > 0) {
    content += `<RIGHT><font# bolder=0 height=1 width=1>打包费  ￥${packagingFee.toFixed(2)}</font#></RIGHT><BR>`
  }
  const finalPrice = (order.finalPrice || 0).toFixed(2)
  content += `<RIGHT><font# bolder=1 height=2 width=2>合计  ￥${finalPrice}</font#></RIGHT><BR>`
  const payStatusText = order.pay_status ? '已付' : '未付'
  content += `<LEFT>支付状态: ${payStatusText}</LEFT><BR>`
  content += `<LEFT>下单时间: ${formatDate(date)}</LEFT><BR>`
  content += `<C>**************<font# bolder=1 height=2 width=1>完</font#><font# bolder=0 height=1 width=1>**************</font#></C><BR>`
  return content
}

// 大趋 print 的 voice 仅支持预设音源代码（16堂食/19打包），中文文本会被当成小票内容打印
function buildOrderTypeVoice(orderType) {
  return orderType === 'dineIn' ? '16' : '19'
}

function buildPayInVoiceText(finalPrice) {
  return (Number(finalPrice) || 0).toFixed(2)
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

async function callPayInVoice(printer, { text, outTradeNo }) {
  return cloud.callFunction({
    name: 'printManage',
    data: {
      $url: 'payInVoice',
      sn: printer.sn,
      text,
      outTradeNo
    }
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

    const kitchenContent = generatePrintContent(orderData, 'kitchen')
    const frontContent = generatePrintContent(orderData, 'front')

    const kitchenRes = await callPrintNote(printer, {
      content: kitchenContent,
      outTradeNo: `${orderId}_kitchen`,
      voice: buildOrderTypeVoice(orderData.orderType)
    })
    const frontRes = await callPrintNote(printer, {
      content: frontContent,
      outTradeNo: `${orderId}_front`
    })

    const kitchenOk = kitchenRes.result && kitchenRes.result.success
    const frontOk = frontRes.result && frontRes.result.success

    if (kitchenOk && frontOk) {
      try {
        const voiceRes = await callPayInVoice(printer, {
          text: buildPayInVoiceText(orderData.finalPrice),
          outTradeNo: `${orderId}_voice`
        })
        if (!(voiceRes.result && voiceRes.result.success)) {
          console.warn('合计金额语音播报失败', voiceRes.result)
        }
      } catch (voiceErr) {
        console.warn('合计金额语音播报异常', voiceErr)
      }
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
    remark,
    pay_status
  } = event

  try {
    const finalOrderType = orderType || (tableNumber ? 'dineIn' : 'takeOut')
    const date = new Date()
    const orderTotal = Number(totalPrice) || 0
    const packagingFee = finalOrderType === 'takeOut' ? PACKAGING_FEE : 0
    const orderFinal = orderTotal + packagingFee
    const { queueDate, queueNumber } = await getNextQueueNumber()

    const orderData = {
      type: 'order',
      goods: orderGoods,
      totalPrice: orderTotal,
      packagingFee,
      finalPrice: orderFinal,
      orderType: finalOrderType,
      pay_status: pay_status === true,
      source: 'staff_verbal',
      remark: remark || '',
      createTime: db.serverDate(),
      _openid: openid,
      tableNumber: tableNumber || '',
      queueDate,
      queueNumber
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
      queueNumber,
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
