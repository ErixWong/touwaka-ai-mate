<script setup lang="ts">
import { ref } from 'vue'
import { useContractV2Store } from '@/stores/contract-v2'
import type { OrgNode } from '@/api/contract-v2'

const store = useContractV2Store()

const showAddDialog = ref(false)
const addForm = ref<{ name: string; node_type: string; parent_id: string | null }>({
  name: '',
  node_type: 'group',
  parent_id: null,
})

const nodeTypeLabels: Record<string, string> = {
  group: '集团',
  party: '甲方',
  project: '项目',
}

function getTypeForLevel(parentId: string | null): string {
  if (!parentId) return 'group'
  const findNode = (nodes: OrgNode[]): OrgNode | undefined => {
    for (const n of nodes) {
      if (n.id === parentId) return n
      if (n.children) {
        const found = findNode(n.children)
        if (found) return found
      }
    }
    return undefined
  }
  const parent = findNode(store.tree)
  if (!parent) return 'group'
  if (parent.level === 1) return 'party'
  if (parent.level === 2) return 'project'
  return 'project'
}

function openAddDialog(parentId: string | null) {
  const type = getTypeForLevel(parentId)
  addForm.value = { name: '', node_type: type, parent_id: parentId }
  showAddDialog.value = true
}

async function handleAddNode() {
  if (!addForm.value.name.trim()) return
  try {
    await store.addNode(addForm.value)
    showAddDialog.value = false
  } catch {}
}

function handleNodeClick(nodeId: string) {
  store.selectedNodeId = store.selectedNodeId === nodeId ? null : nodeId
}

async function handleDeleteNode(nodeId: string) {
  try {
    await ElMessageBox.confirm('删除节点将同时删除所有子节点和关联合同，确认删除？', '确认', {
      confirmButtonText: '删除',
      cancelButtonText: '取消',
      type: 'warning',
    })
    await store.removeNode(nodeId)
  } catch {}
}

const defaultProps = {
  children: 'children',
  label: 'name',
}
</script>

<template>
  <div class="org-tree-container">
    <div class="org-tree-header">
      <span class="org-tree-title">组织结构</span>
      <el-button size="small" type="primary" @click="openAddDialog(null)">
        <el-icon><Plus /></el-icon>
        新建
      </el-button>
    </div>

    <div v-if="store.treeLoading" class="org-tree-loading">
      <el-skeleton :rows="5" animated />
    </div>

    <div v-else-if="store.tree.length === 0" class="org-tree-empty">
      <el-empty description="暂无组织节点" :image-size="48" />
      <el-button type="primary" size="small" @click="openAddDialog(null)">创建集团节点</el-button>
    </div>

    <el-tree
      v-else
      :data="store.tree"
      :props="defaultProps"
      node-key="id"
      highlight-current
      :default-expand-all="true"
      @node-click="(data: any) => handleNodeClick(data.id)"
      :class="{ 'has-selection': store.selectedNodeId }"
    >
      <template #default="{ node, data }">
        <div class="tree-node" :class="{ selected: data.id === store.selectedNodeId }">
          <span class="tree-node-label">
            <el-tag size="small" :type="data.node_type === 'group' ? '' : data.node_type === 'party' ? 'success' : 'warning'" disable-transitions>
              {{ nodeTypeLabels[data.node_type] || data.node_type }}
            </el-tag>
            <span class="tree-node-name">{{ data.name }}</span>
          </span>
          <span class="tree-node-actions" @click.stop>
            <el-button size="small" text @click="openAddDialog(data.id)" v-if="data.level < 3">
              <el-icon><Plus /></el-icon>
            </el-button>
            <el-button size="small" text type="danger" @click="handleDeleteNode(data.id)">
              <el-icon><Delete /></el-icon>
            </el-button>
          </span>
        </div>
      </template>
    </el-tree>

    <el-dialog v-model="showAddDialog" :title="'新建' + nodeTypeLabels[addForm.node_type]" width="400px">
      <el-form label-width="80px">
        <el-form-item label="名称">
          <el-input v-model="addForm.name" placeholder="请输入名称" @keyup.enter="handleAddNode" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showAddDialog = false">取消</el-button>
        <el-button type="primary" @click="handleAddNode" :disabled="!addForm.name.trim()">确定</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.org-tree-container {
  height: 100%;
  display: flex;
  flex-direction: column;
}

.org-tree-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  border-bottom: 1px solid var(--el-border-color-light);
}

.org-tree-title {
  font-weight: 600;
  font-size: 14px;
}

.org-tree-loading {
  padding: 16px;
}

.org-tree-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 32px 16px;
  gap: 8px;
}

.el-tree {
  flex: 1;
  overflow-y: auto;
}

.tree-node {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  padding: 2px 0;
}

.tree-node.selected .tree-node-name {
  color: var(--el-color-primary);
  font-weight: 600;
}

.tree-node-label {
  display: flex;
  align-items: center;
  gap: 6px;
}

.tree-node-name {
  font-size: 13px;
}

.tree-node-actions {
  display: none;
}

.tree-node:hover .tree-node-actions {
  display: flex;
}
</style>
