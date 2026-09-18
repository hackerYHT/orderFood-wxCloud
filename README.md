# 店员口头点餐打印小程序

基于微信云开发的 **店员专用** 点餐打印工具：店员根据顾客口头点单在小程序中选菜，提交后自动打印厨房小票。**不含在线支付、会员充值等功能。**

---

## 功能简介

### 店员日常使用

1. **选菜点餐** — 按分类浏览菜品，加入购物车，支持规格/口味标签
2. **确认打印** — 选择堂食/打包，填写桌号与备注（均可选），提交后自动打印小票
3. **订单记录** — 查看本机提交的打印订单历史

### 管理后台

在「设置」页右下角连续点击 5 次进入管理后台：

- 菜品管理、订单管理、公告管理
- 店铺设置、桌码管理（可选）
- **打印机管理** — 绑定大趋智能 WiFi 小票机、测试打印
- 修改管理员密码

---

## 口头点餐 + 打印流程

```
顾客口头点单 → 店员在「点餐」页选菜 → 点击「确认打印」
    → 填写桌号/备注（可选）→ 点击「提交并打印」
    → 云函数创建订单 → 调用大趋智能 API 打印小票 → 跳转订单记录
```

- 无需扫码、无需顾客登录、无需支付
- 未绑定打印机时订单仍会保存，但不会出纸（会提示「未连接打印机」）

---

## 小票打印机接入

详细步骤见 **[docs/PRINTER_SETUP.md](./docs/PRINTER_SETUP.md)**，主要包括：

1. 购买大趋智能 WiFi 云打印机，记录 SN 和 KEY
2. 在 [大趋智能开放平台](https://open.trenditiot.com) 注册，获取 AppID / AppSecret（开发文档：[trendit.cn/dev](https://trendit.cn/dev)）
3. 配置并上传 `printManage`、`printBack`、`doBuy` 云函数
4. 在管理后台 → 打印机管理 中绑定设备并测试打印

---

## 快速部署

### 环境要求

- 微信开发者工具（最新版）
- 已注册微信小程序账号
- 已开通微信云开发

### 1. 配置云环境

编辑 `miniprogram/app.js` 或 `miniprogram/envList.js`，填入云环境 ID：

```javascript
wx.cloud.init({
  env: '你的云环境ID',
  traceUser: true,
})
```

### 2. 创建数据库集合

在云开发控制台创建以下集合（权限可按需设置）：

| 集合 | 用途 |
|------|------|
| `user` | 店员 openid 记录（自动创建） |
| `dish` | 菜品（建议权限：**所有用户可读，仅创建者可写**；删除走 `deleteDish` 云函数以绕过创建者限制） |
| `dishCategory` | 菜品分类 |
| `notice` | 公告 |
| `order` | 点餐订单 |
| `printer` | 打印机配置 |
| `shopInfo` | 店铺信息 |
| `admin` | 管理员密码 |
| `tableCode` | 桌码（可选） |

> 以下集合为旧版支付/会员功能遗留，本版不再使用，可不创建：`rechargeOptions`、`freeBuy`

### 3. 上传云函数

右键上传并部署（云端安装依赖）：

| 云函数 | 是否必需 | 说明 |
|--------|----------|------|
| `login` | ✅ | 用户登录 |
| `getCategory` | ✅ | 获取菜品分类 |
| `deleteDish` | ✅ | 删除菜品（清理标签引用，服务端硬删/软删） |
| `doBuy` | ✅ | 创建订单并打印 |
| `printManage` | ✅ | 打印机 API |
| `printBack` | 推荐 | 打印回调 |
| `get_code` | 可选 | 生成桌码 |
| `getPhoneNumber` | 可选 | 获取手机号 |
| `getUserList` | 可选 | 旧版会员管理 |
| `pay` | ❌ 不需要 | 已移除支付功能 |
| `pay_success` | ❌ 不需要 | 已移除支付功能 |

### 4. 配置打印机

见 [docs/PRINTER_SETUP.md](./docs/PRINTER_SETUP.md)

### 5. 编译运行

在微信开发者工具中点击「编译」，即可在模拟器或真机上使用。

---

## 目录结构

```
orderFood-wxCloud/
├── cloudfunctions/
│   ├── login/           # 登录
│   ├── getCategory/     # 菜品分类
│   ├── doBuy/           # 下单 + 打印
│   ├── printManage/     # 大趋智能打印 API
│   ├── printBack/       # 打印回调
│   └── pay/             # （遗留，未使用）
├── miniprogram/
│   ├── pages/
│   │   ├── index/       # 点餐选菜
│   │   ├── settle/      # 确认打印
│   │   ├── myorder/     # 订单记录
│   │   ├── myhome/      # 设置 / 管理入口
│   │   └── admin/       # 管理后台
│   └── app.js
└── docs/
    └── PRINTER_SETUP.md # 打印机接入文档
```

---

## 微信开发者工具手动步骤

1. **导入项目** — 用开发者工具打开本仓库
2. **填写 AppID** — 在 `project.config.json` 中配置你的小程序 AppID
3. **开通云开发** — 创建云环境，将环境 ID 写入 `envList.js`
4. **上传云函数** — 至少上传 `login`、`getCategory`、`deleteDish`、`doBuy`、`printManage`
5. **配置 printManage** — 填入大趋智能 AppID / AppSecret 后重新上传
6. **创建数据库集合** — 见上文表格
7. **添加测试菜品** — 管理后台 → 菜品管理
8. **绑定打印机** — 管理后台 → 打印机管理 → 测试打印
9. **真机调试** — 建议用真机测试打印（模拟器无法连接实体打印机）

---

## 技术栈

- 微信云开发（云函数 + 云数据库）
- UI：Vant Weapp + ColorUI
- 打印：大趋智能 IoT 云打印 API（`iot-device.trenditiot.com`）
