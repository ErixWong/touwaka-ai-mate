import ContractV2Service from '../../../../services/contract-v2.service.js';

// Handler 元数据：声明具名参数路径
export const route = {
  path: '/contracts/:contractId/versions/from-attachment',
};

export async function post(ctx, deps) {
  // 命名参数 contractId 现在会自动注入（来自 route.path 声明）
  const contractId = ctx.params.contractId || ctx.params.p0;
  const { file_id, contract_type, version_number, version_name, version_type, document_mode, existing_document_id } = ctx.request.body || {};
  const userId = ctx.state?.session?.id;

  if (!file_id) {
    ctx.error('file_id 必填', 400);
    return;
  }

  if (!contract_type) {
    ctx.error('contract_type 必填', 400);
    return;
  }

  if (!userId) {
    ctx.error('未登录', 401);
    return;
  }

  const contractV2Service = new ContractV2Service(deps.db);

  try {
    const version = await contractV2Service.createVersionFromAttachment(
      contractId,
      file_id,
      { contract_type, version_number, version_name, version_type, document_mode, existing_document_id },
      userId
    );
    ctx.success(version);
  } catch (error) {
    ctx.error(error.message, 400);
  }
}