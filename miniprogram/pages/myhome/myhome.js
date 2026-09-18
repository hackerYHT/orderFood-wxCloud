// pages/myhome/myhome.js
const db = wx.cloud.database()

Page({
  data: {
    shopInfo: {},
    clickCount: 0,
    clickTimer: null,
    showPasswordModal: false,
    adminPassword: '',
    isFirstTime: false,
    version: ''
  },

  onLoad() {
    this.loadShopInfo()
    this.getVersion()
  },

  onShow() {
    this.loadShopInfo()
  },

  async loadShopInfo() {
    try {
      const res = await db.collection('shopInfo').limit(1).get()
      if (res.data && res.data.length > 0) {
        this.setData({ shopInfo: res.data[0] })
      }
    } catch (err) {
      console.error('加载店铺信息失败', err)
    }
  },

  onAdminTrigger() {
    this.data.clickCount++

    if (this.data.clickTimer) {
      clearTimeout(this.data.clickTimer)
    }

    if (this.data.clickCount >= 5) {
      this.data.clickCount = 0
      this.checkAdminFirstTime()
    } else {
      this.data.clickTimer = setTimeout(() => {
        this.data.clickCount = 0
      }, 1000)
    }
  },

  async checkAdminFirstTime() {
    try {
      wx.showLoading({ title: '检查中...' })
      const res = await db.collection('admin').get()

      wx.hideLoading()
      this.setData({
        showPasswordModal: true,
        isFirstTime: res.data.length === 0,
        adminPassword: ''
      })
    } catch (err) {
      wx.hideLoading()
      console.error('检查管理员失败', err)
      this.setData({
        showPasswordModal: true,
        isFirstTime: true,
        adminPassword: ''
      })
    }
  },

  closePasswordModal() {
    this.setData({
      showPasswordModal: false,
      adminPassword: ''
    })
  },

  noop() {},

  stopPropagation() {},

  onPasswordInput(e) {
    this.setData({ adminPassword: e.detail.value })
  },

  async verifyPassword() {
    const password = this.data.adminPassword.trim()

    if (!password) {
      wx.showToast({ title: '请输入密码', icon: 'none' })
      return
    }

    if (password.length < 6) {
      wx.showToast({ title: '密码长度不能少于6位', icon: 'none' })
      return
    }

    try {
      wx.showLoading({ title: this.data.isFirstTime ? '设置中...' : '验证中...' })
      const res = await db.collection('admin').limit(1).get()

      if (this.data.isFirstTime) {
        if (res.data && res.data.length > 0) {
          wx.hideLoading()
          wx.showToast({ title: '管理员已存在，请登录', icon: 'none' })
          this.setData({ isFirstTime: false, adminPassword: '' })
          return
        }

        await db.collection('admin').add({
          data: {
            password,
            createTime: new Date(),
            updateTime: new Date()
          }
        })

        wx.hideLoading()
        wx.showToast({ title: '密码设置成功', icon: 'success' })
        wx.navigateTo({ url: '/pages/admin/admin' })
        this.closePasswordModal()
        return
      }

      wx.hideLoading()

      if (res.data.length === 0) {
        wx.showToast({ title: '管理员未设置', icon: 'none' })
        return
      }

      if (res.data[0].password === password) {
        wx.navigateTo({ url: '/pages/admin/admin' })
        this.closePasswordModal()
      } else {
        wx.showToast({ title: '密码错误', icon: 'none' })
      }
    } catch (err) {
      wx.hideLoading()
      console.error('操作失败', err)
      wx.showToast({ title: '操作失败，请重试', icon: 'none' })
    }
  },

  goToPrinterDoc() {
    wx.showModal({
      title: '打印机配置说明',
      content: '请查看项目根目录 docs/PRINTER_SETUP.md，或在管理后台 → 打印机管理 中绑定设备。',
      showCancel: false
    })
  },

  getVersion() {
    const accountInfo = wx.getAccountInfoSync()
    this.setData({
      version: accountInfo.miniProgram.version || '1.0.0'
    })
  }
})
