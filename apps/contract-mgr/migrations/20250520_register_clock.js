export default {
  async check(sequelize) {
    const rows = await sequelize.query(`
      SELECT id FROM app_clock_registry WHERE app_id = 'contract-mgr'
    `, { type: sequelize.QueryTypes.SELECT });
    
    return rows.length > 0;
  },

  async up(sequelize) {
    const [apps] = await sequelize.query(`
      SELECT id FROM mini_apps WHERE id = 'contract-mgr'
    `);
    
    if (apps.length === 0) {
      console.log('  ⏭️  Skipped: contract-mgr not found in mini_apps');
      return;
    }
    
    await sequelize.query(`
      INSERT INTO app_clock_registry (id, app_id, tick_script, is_active)
      VALUES (?, 'contract-mgr', NULL, 1)
    `, { replacements: [require('../../lib/utils.js').default.newID(20)] });
    
    console.log('  ✓ Registered contract-mgr to app_clock_registry');
  },

  async down(sequelize) {
    await sequelize.query(`
      DELETE FROM app_clock_registry WHERE app_id = 'contract-mgr'
    `);
    console.log('  ✓ Removed contract-mgr from app_clock_registry');
  }
};