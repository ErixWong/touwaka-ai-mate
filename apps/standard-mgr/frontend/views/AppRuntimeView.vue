<template>
  <div class="standard-mgr-placeholder">
    <div class="placeholder-content">
      <el-icon :size="64" color="#409EFF"><Document /></el-icon>
      <h2>标准管理</h2>
      <p>标准文档纳管、引用清洗与锚点定位</p>
      <p class="placeholder-note">功能开发中，敬请期待</p>
    </div>
  </div>
</template>

<script setup>
import { Document } from '@element-plus/icons-vue';
</script>

<style scoped>
.standard-mgr-placeholder {
  display: flex;
  justify-content: center;
  align-items: center;
  min-height: 400px;
}
.placeholder-content {
  text-align: center;
  color: #606266;
}
.placeholder-content h2 {
  margin: 16px 0 8px;
  font-size: 20px;
  color: #303133;
}
.placeholder-note {
  margin-top: 16px;
  font-size: 13px;
  color: #c0c4cc;
}
</style>
