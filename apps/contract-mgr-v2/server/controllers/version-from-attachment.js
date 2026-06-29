import ContractV2Service from '../../../../server/services/contract-v2.service.js';

export default function createVersionFromAttachmentHandler(context) {
  return {
    async post(ctx) {
      const { contractId } = ctx.params;
      const { file_id, contract_type, version_number, version_name, version_type } = ctx.request.body || {};
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

      const contractV2Service = new ContractV2Service(context.db);

      try {
        const version = await contractV2Service.createVersionFromAttachment(
          contractId,
          file_id,
          { contract_type, version_number, version_name, version_type },
          userId
        );
        ctx.success(version);
      } catch (error) {
        ctx.error(error.message, 400);
      }
    }
  };
}
