/**
 * Vector Utilities - 向量处理工具函数
 *
 * 提供向量维度调整等通用功能，供 embedding-worker 和 kb.controller 使用
 */

/**
 * 数据库 VECTOR 字段的固定维度
 * MariaDB VECTOR(1536) 类型要求向量必须是 1536 维
 * 
 * 支持的嵌入模型维度：
 * - bge-m3: 1024 维（需要填充到 1536）
 * - text-embedding-3-small: 1536 维（无需调整）
 * - text-embedding-ada-002: 1536 维（无需调整）
 */
export const DB_VECTOR_DIM = 1536;

/**
 * 调整向量维度以匹配数据库要求
 * 
 * 如果输入向量维度与数据库要求不一致：
 * - 维度过大：截断到 DB_VECTOR_DIM（可能丢失信息）
 * - 维度过小：用零填充到 DB_VECTOR_DIM
 * 
 * @param {number[]} embedding - 原始嵌入向量
 * @returns {{ vector: number[], adjusted: boolean, originalDim: number }} 调整后的向量及调整信息
 */
export function adjustVectorDimension(embedding) {
  if (!embedding || !Array.isArray(embedding)) {
    return { vector: null, adjusted: false, originalDim: 0 };
  }

  const originalDim = embedding.length;
  
  // 维度匹配，无需调整
  if (originalDim === DB_VECTOR_DIM) {
    return { vector: embedding, adjusted: false, originalDim };
  }

  // 维度过大，截断
  if (originalDim > DB_VECTOR_DIM) {
    const truncated = embedding.slice(0, DB_VECTOR_DIM);
    return { 
      vector: truncated, 
      adjusted: true, 
      originalDim,
      action: 'truncated',
      message: `Truncated vector from ${originalDim} to ${DB_VECTOR_DIM} (may lose information)`
    };
  }

  // 维度过小，零填充
  const padded = [...embedding, ...new Array(DB_VECTOR_DIM - originalDim).fill(0)];
  return { 
    vector: padded, 
    adjusted: true, 
    originalDim,
    action: 'padded',
    message: `Padded vector from ${originalDim} to ${DB_VECTOR_DIM} with zeros`
  };
}

/**
 * 将向量转换为 VEC_FromText 函数所需的 JSON 字符串格式
 * @param {number[]} vector - 向量数组
 * @returns {string} JSON 数组字符串
 */
export function vectorToJson(vector) {
  return JSON.stringify(vector);
}