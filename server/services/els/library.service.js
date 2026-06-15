import logger from '../../../lib/logger.js';
import Utils from '../../../lib/utils.js';

class LibraryService {
  constructor(db) {
    this.db = db;
    this.Library = null;
    this.Material = null;
  }

  _ensureModels() {
    if (!this.Library) {
      this.Library = this.db.getModel('app_els_libraries');
    }
    if (!this.Material) {
      this.Material = this.db.getModel('app_els_materials');
    }
  }

  async list(userId) {
    this._ensureModels();
    
    const libraries = await this.Library.findAll({
      where: {
        is_active: true,
        [this.db.Op.or]: [
          { library_type: 'public' },
          { owner_user_id: userId },
        ],
      },
      order: [['library_type', 'ASC'], ['created_at', 'DESC']],
      raw: true,
    });
    
    const result = [];
    for (const lib of libraries) {
      const materialCount = await this.Material.count({
        where: {
          library_id: lib.id,
          processing_status: 'ready',
        },
      });
      
      result.push({
        id: lib.id,
        name: lib.name,
        type: lib.library_type,
        material_count: materialCount,
        is_selected: false,
      });
    }
    
    return result;
  }

  async getById(libraryId) {
    this._ensureModels();
    
    return this.Library.findOne({
      where: { id: libraryId, is_active: true },
      raw: true,
    });
  }

  async getMaterials(libraryId, userId) {
    this._ensureModels();
    
    const library = await this.getById(libraryId);
    if (!library) {
      const error = new Error('学习库不存在');
      error.code = 'ELS_NOT_FOUND';
      error.status = 404;
      throw error;
    }
    
    if (library.library_type === 'personal' && library.owner_user_id !== userId) {
      const error = new Error('无权访问该学习库');
      error.code = 'ELS_FORBIDDEN';
      error.status = 403;
      throw error;
    }
    
    const isOwner = library.owner_user_id === userId;
    const whereClause = { library_id: libraryId };
    
    if (!isOwner && library.library_type === 'public') {
      whereClause.processing_status = 'ready';
    }
    
    const materials = await this.Material.findAll({
      where: whereClause,
      order: [['updated_at', 'DESC']],
      raw: true,
    });
    
    const items = materials.map((m) => ({
      id: m.id,
      title: m.title,
      summary: m.summary,
      language: m.language,
      processing_status: m.processing_status,
      status_reason: m.status_reason,
      quiz_status: m.quiz_status,
      tts_enabled: true,
      can_read: m.processing_status === 'ready',
      can_edit: m.owner_user_id === userId && m.source_type === 'user_upload',
      updated_at: m.updated_at,
    }));
    
    return {
      library: {
        id: library.id,
        name: library.name,
        type: library.library_type,
      },
      items,
    };
  }

  async ensureDefaultPublicLibrary() {
    this._ensureModels();
    
    const existing = await this.Library.findOne({
      where: { library_type: 'public', is_default: true },
    });
    
    if (existing) {
      return existing;
    }
    
    const id = Utils.newID(20);
    await this.Library.create({
      id,
      name: '公共推荐库',
      library_type: 'public',
      is_default: true,
      is_active: true,
    });
    
    logger.info(`[LibraryService] Created default public library ${id}`);
    return this.getById(id);
  }

  async ensurePersonalLibrary(userId) {
    this._ensureModels();
    
    const existing = await this.Library.findOne({
      where: { owner_user_id: userId, library_type: 'personal' },
    });
    
    if (existing) {
      return existing;
    }
    
    const id = Utils.newID(20);
    await this.Library.create({
      id,
      owner_user_id: userId,
      name: '我的学习库',
      library_type: 'personal',
      is_default: false,
      is_active: true,
    });
    
    logger.info(`[LibraryService] Created personal library for user ${userId}`);
    return this.getById(id);
  }

  async getMaterialCount(libraryId, userId) {
    this._ensureModels();
    
    const library = await this.getById(libraryId);
    if (!library) {
      return 0;
    }
    
    if (library.library_type === 'personal' && library.owner_user_id !== userId) {
      return 0;
    }
    
    return this.Material.count({
      where: {
        library_id: libraryId,
        processing_status: 'ready',
      },
    });
  }
}

export default LibraryService;
