import logger from '../../lib/logger.js';
import Utils from '../../lib/utils.js';

class MaterialService {
  constructor(db) {
    this.db = db;
    this.Material = null;
    this.Library = null;
  }

  _ensureModels() {
    if (!this.Material) {
      this.Material = this.db.getModel('app_els_materials');
    }
    if (!this.Library) {
      this.Library = this.db.getModel('app_els_libraries');
    }
  }

  async getById(materialId) {
    this._ensureModels();
    
    return this.Material.findOne({
      where: { id: materialId },
      raw: true,
    });
  }

  async getRecommended(libraryId, userId) {
    this._ensureModels();
    
    const library = await this.Library.findOne({
      where: { id: libraryId, is_active: true },
      raw: true,
    });
    
    if (!library) {
      const error = new Error('学习库不存在');
      error.code = 'ELS_NOT_FOUND';
      error.status = 404;
      throw error;
    }
    
    if (library.library_type === 'personal' && library.owner_user_id !== userId) {
      const error = new Error('无权获取该学习库的推荐材料');
      error.code = 'ELS_FORBIDDEN';
      error.status = 403;
      throw error;
    }
    
    const materials = await this.Material.findAll({
      where: {
        library_id: libraryId,
        processing_status: 'ready',
        quiz_status: 'ready',
      },
      order: [['published_at', 'DESC']],
      limit: 5,
      raw: true,
    });
    
    return materials.map((m) => ({
      id: m.id,
      library_id: m.library_id,
      title: m.title,
      summary: m.summary,
      difficulty_level: m.difficulty_level,
      estimated_minutes: 3,
    }));
  }

  async getDetail(materialId, userId) {
    this._ensureModels();
    
    const material = await this.getById(materialId);
    
    if (!material) {
      const error = new Error('材料不存在');
      error.code = 'ELS_NOT_FOUND';
      error.status = 404;
      throw error;
    }
    
    const library = await this.Library.findOne({
      where: { id: material.library_id },
      raw: true,
    });
    
    if (!library) {
      const error = new Error('所属学习库不存在');
      error.code = 'ELS_NOT_FOUND';
      error.status = 404;
      throw error;
    }
    
    const canAccess = this._canUserAccessMaterial(library, material, userId);
    if (!canAccess) {
      const error = new Error('无权访问该材料');
      error.code = 'ELS_FORBIDDEN';
      error.status = 403;
      throw error;
    }
    
    return {
      id: material.id,
      library_id: material.library_id,
      library_name: library.name || '未知学习库',
      title: material.title,
      summary: material.summary,
      content: material.content,
      language: material.language,
      processing_status: material.processing_status,
      status_reason: material.status_reason,
      quiz_status: material.quiz_status,
      difficulty_level: material.difficulty_level,
      tts: {
        available: true,
        mode: 'realtime',
        voices: ['female', 'male'],
        default_voice: 'female',
        speeds: [0.8, 1.0, 1.2],
      },
      progress: {
        is_read: false,
        collected_word_count: 0,
      },
    };
  }

  _canUserAccessMaterial(library, material, userId) {
    const isOwner = material.owner_user_id === userId;
    
    if (material.processing_status === 'ready') {
      if (library.library_type === 'public') return true;
      if (library.library_type === 'personal' && library.owner_user_id === userId) return true;
      if (isOwner) return true;
      return false;
    }
    
    if (isOwner) return true;
    if (library.library_type === 'personal' && library.owner_user_id === userId) return true;
    
    return false;
  }

  async create(userId, libraryId, payload) {
    this._ensureModels();
    
    const library = await this.Library.findOne({
      where: { id: libraryId },
      raw: true,
    });
    
    if (!library) {
      const error = new Error('目标学习库不存在');
      error.code = 'ELS_NOT_FOUND';
      error.status = 404;
      throw error;
    }
    
    if (library.library_type !== 'personal') {
      const error = new Error('只允许上传到个人学习库');
      error.code = 'ELS_FORBIDDEN';
      error.status = 403;
      throw error;
    }
    
    if (library.owner_user_id !== userId) {
      const error = new Error('只能上传到自己的个人库');
      error.code = 'ELS_FORBIDDEN';
      error.status = 403;
      throw error;
    }
    
    const id = Utils.newID(20);
    
    await this.Material.create({
      id,
      library_id: libraryId,
      owner_user_id: userId,
      source_type: 'user_upload',
      title: payload.title,
      summary: payload.summary || null,
      content: payload.content,
      language: payload.language || 'en',
      processing_status: 'processing',
      status_reason: null,
      quiz_status: 'pending',
      difficulty_level: null,
      metadata: payload.tags ? JSON.stringify({ tags: payload.tags }) : null,
    });
    
    logger.info(`[MaterialService] Created material ${id} by user ${userId} in library ${libraryId}`);
    
    return {
      id,
      library_id: libraryId,
      processing_status: 'processing',
      status_reason: null,
      can_read: false,
    };
  }

  async update(materialId, userId, payload) {
    this._ensureModels();
    
    const material = await this.getById(materialId);
    
    if (!material) {
      const error = new Error('材料不存在');
      error.code = 'ELS_NOT_FOUND';
      error.status = 404;
      throw error;
    }
    
    if (material.owner_user_id !== userId) {
      const error = new Error('只能编辑自己上传的材料');
      error.code = 'ELS_FORBIDDEN';
      error.status = 403;
      throw error;
    }
    
    const updates = {};
    
    if (payload.title) updates.title = payload.title;
    if (payload.summary) updates.summary = payload.summary;
    if (payload.content) {
      updates.content = payload.content;
      updates.processing_status = 'processing';
      updates.status_reason = null;
      updates.quiz_status = 'pending';
    }
    if (payload.tags) updates.metadata = JSON.stringify({ tags: payload.tags });
    
    if (Object.keys(updates).length > 0) {
      await this.Material.update(updates, { where: { id: materialId } });
      logger.info(`[MaterialService] Updated material ${materialId}`);
    }
    
    const updatedMaterial = await this.getById(materialId);
    
    return {
      id: updatedMaterial.id,
      library_id: updatedMaterial.library_id,
      title: updatedMaterial.title,
      summary: updatedMaterial.summary,
      processing_status: updatedMaterial.processing_status,
      status_reason: updatedMaterial.status_reason,
      quiz_status: updatedMaterial.quiz_status,
      can_read: updatedMaterial.processing_status === 'ready',
    };
  }
}

export default MaterialService;