/**
 * Platform system account helpers.
 *
 * The shared `system-bot` account is reserved for platform-owned background
 * work. It is created by the database initialization/upgrade scripts with an
 * `inactive` status and a random password, so it cannot log in normally.
 * Internal task JWTs may still authenticate it because the auth middleware
 * only rejects banned/disabled users.
 */

export const SYSTEM_USER_USERNAME = 'system-bot';

function getModel(db, modelName) {
  if (!db || typeof db.getModel !== 'function') {
    throw new Error(`无法读取系统账户：数据库模型 ${modelName} 不可用`);
  }

  const Model = db.getModel(modelName);
  if (!Model) {
    throw new Error(`无法读取系统账户：数据库模型 ${modelName} 不可用`);
  }
  return Model;
}

/**
 * Find the platform system user.
 *
 * Run scripts/upgrade-database.js before using this helper when the account
 * is missing; this helper deliberately does not create users at runtime.
 */
export async function ensureSystemUser(db) {
  const User = getModel(db, 'user');
  if (typeof User.findOne !== 'function') {
    throw new Error('无法读取系统账户：数据库模型 user 不支持查询');
  }
  const user = await User.findOne({
    where: { username: SYSTEM_USER_USERNAME },
    attributes: ['id', 'status'],
    raw: true,
  });

  if (!user?.id) {
    throw new Error(
      `系统账户 ${SYSTEM_USER_USERNAME} 不存在，请先运行 scripts/upgrade-database.js`,
    );
  }

  return user;
}

/**
 * Return the session shape used by chat/tool execution for system work.
 *
 * The system account intentionally has no role assignment. Rejecting an
 * accidental admin assignment prevents the account from gaining capabilities
 * through the roles array even though isAdmin is explicitly false.
 */
export async function getSystemUserSession(db) {
  const user = await ensureSystemUser(db);
  const UserRole = getModel(db, 'user_role');
  const Role = getModel(db, 'role');
  if (typeof UserRole.findAll !== 'function') {
    throw new Error('无法读取系统账户：数据库模型 user_role 不支持查询');
  }
  const roleRecords = await UserRole.findAll({
    where: { user_id: user.id },
    include: [{
      model: Role,
      as: 'role',
      attributes: ['mark'],
    }],
    raw: true,
    nest: true,
  });
  const roles = [...new Set(roleRecords.map(record => record.role?.mark).filter(Boolean))];

  if (roles.includes('admin')) {
    throw new Error(`系统账户 ${SYSTEM_USER_USERNAME} 不得分配 admin 角色`);
  }

  return {
    id: user.id,
    roles,
    isAdmin: false,
    isSystem: true,
  };
}
