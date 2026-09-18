async function getCloudImageUrl(fileID) {
  if (!fileID || !fileID.startsWith('cloud://')) {
    return fileID || ''
  }

  const res = await wx.cloud.getTempFileURL({ fileList: [fileID] })
  const item = res.fileList && res.fileList[0]
  return (item && item.tempFileURL) || fileID
}

async function resolveCloudImageUrls(items, key = 'image') {
  if (!items || !items.length) {
    return items || []
  }

  const urlKey = `${key}Url`
  const cloudIds = [...new Set(
    items.map(item => item[key]).filter(id => id && id.startsWith('cloud://'))
  )]

  if (!cloudIds.length) {
    return items.map(item => ({
      ...item,
      [urlKey]: item[key] || ''
    }))
  }

  const res = await wx.cloud.getTempFileURL({ fileList: cloudIds })
  const urlMap = {}
  ;(res.fileList || []).forEach(item => {
    urlMap[item.fileID] = item.tempFileURL || item.fileID
  })

  return items.map(item => {
    const value = item[key]
    return {
      ...item,
      [urlKey]: value && value.startsWith('cloud://')
        ? (urlMap[value] || value)
        : (value || '')
    }
  })
}

module.exports = {
  getCloudImageUrl,
  resolveCloudImageUrls
}
