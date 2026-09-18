function getErrorMessage(err) {
  if (!err) return ''
  if (typeof err === 'string') return err
  return err.errMsg || err.message || String(err)
}

function formatRemoveError(err, entityName = '记录') {
  const message = getErrorMessage(err)

  if (message.includes('cannot remove document')) {
    if (message.includes('permission') || message.includes('Write permission')) {
      if (entityName === '分类') {
        return `${entityName}删除失败：无写入权限。请上传并部署 deleteCategory 云函数，或在云开发控制台将 dishCategory 集合权限设为 write:true`
      }
      return `${entityName}删除失败：无写入权限。请上传并部署 deleteDish 云函数，或在云开发控制台将 dish 集合权限设为 write:true`
    }
    return `${entityName}不存在或已被删除，请刷新后重试`
  }

  if (message.includes('FunctionName parameter could not be found') || message.includes('deleteCategory')) {
    return `${entityName}删除失败：请先上传并部署 deleteCategory 云函数`
  }

  if (message.includes('deleteDish')) {
    return `${entityName}删除失败：请先上传并部署 deleteDish 云函数`
  }

  if (message.includes('permission') || message.includes('PERMISSION_DENIED')) {
    return `${entityName}删除失败：无写入权限`
  }

  return `${entityName}删除失败，请稍后重试`
}

module.exports = {
  getErrorMessage,
  formatRemoveError
}
