const TABLES = [
  'app_els_user_preferences',
  'app_els_user_study_days',
  'app_els_user_reviews',
  'app_els_user_words',
  'app_els_materials',
  'app_els_notebooks',
  'app_els_libraries',
];

async function check(sequelize) {
  try {
    const [results] = await sequelize.query(
      "SHOW TABLES LIKE 'app_els_%'"
    );
    return results.length > 0;
  } catch (error) {
    console.error('ELS uninstall check error:', error);
    return false;
  }
}

async function up(sequelize) {
  console.log('ELS uninstall: Dropping all ELS tables...');
  
  for (const table of TABLES) {
    try {
      await sequelize.query(`DROP TABLE IF EXISTS ${table}`);
      console.log(`ELS uninstall: Dropped ${table}`);
    } catch (error) {
      console.error(`ELS uninstall: Error dropping ${table}:`, error.message);
    }
  }
  
  console.log('ELS uninstall: All tables dropped successfully');
}

async function down(sequelize) {
  console.log('ELS uninstall: Cannot restore dropped tables automatically');
  console.log('ELS uninstall: Please run install.js to recreate tables');
}

export default { check, up, down };