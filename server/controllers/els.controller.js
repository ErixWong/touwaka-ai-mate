const LIBRARIES = [
  {
    id: 'lib_public_default',
    name: '公共推荐库',
    type: 'public',
    material_count: 128,
    is_selected: true,
  },
  {
    id: 'lib_personal_001',
    name: '我的生物短文库',
    type: 'personal',
    material_count: 12,
    is_selected: false,
  },
  {
    id: 'lib_fr_001',
    name: '法语阅读练习库',
    type: 'shared',
    material_count: 18,
    is_selected: false,
  },
];

const NOTEBOOKS = [
  {
    id: 'nb_en_default',
    language: 'en',
    name: '英语词本',
    word_count: 128,
    is_selected: true,
  },
  {
    id: 'nb_fr_default',
    language: 'fr',
    name: '法语词本',
    word_count: 42,
    is_selected: false,
  },
];

const MATERIALS = {
  lib_public_default: [
    {
      id: 'mat_001',
      title: 'Why sleep matters',
      summary: 'A short article about sleep and memory.',
      language: 'en',
      processing_status: 'ready',
      safety_status: 'passed',
      quiz_status: 'ready',
      tts_status: 'ready',
      can_read: true,
      can_edit: false,
      updated_at: '2026-06-12T09:00:00+08:00',
      difficulty_level: 'B1',
      library_id: 'lib_public_default',
      library_name: '公共推荐库',
      estimated_minutes: 4,
      content: 'Sleep helps the brain store memories. Good sleep also improves attention, mood, and long-term learning performance. A short walk, less screen time at night, and a stable routine can all improve sleep quality.',
    },
    {
      id: 'mat_002',
      title: 'Small daily habits',
      summary: 'Tiny habits can shape long-term learning results.',
      language: 'en',
      processing_status: 'ready',
      safety_status: 'passed',
      quiz_status: 'ready',
      tts_status: 'pending',
      can_read: true,
      can_edit: false,
      updated_at: '2026-06-11T14:30:00+08:00',
      difficulty_level: 'A2',
      library_id: 'lib_public_default',
      library_name: '公共推荐库',
      estimated_minutes: 3,
      content: 'Daily learning does not need to be long. Reading for five minutes, repeating one sentence, and reviewing one mistake can already build a strong habit over time.',
    },
  ],
  lib_personal_001: [
    {
      id: 'mat_user_001',
      title: 'My Biology Note',
      summary: 'Short note about cell division.',
      language: 'en',
      processing_status: 'pending_safety_review',
      safety_status: 'pending',
      quiz_status: 'pending',
      tts_status: 'pending',
      can_read: false,
      can_edit: true,
      updated_at: '2026-06-12T10:20:00+08:00',
      difficulty_level: 'B1',
      library_id: 'lib_personal_001',
      library_name: '我的生物短文库',
      estimated_minutes: 2,
      content: 'Cell division is the process by which a parent cell divides into two or more daughter cells.',
    },
    {
      id: 'mat_user_002',
      title: 'Microscope Basics',
      summary: 'Simple notes about using a microscope safely.',
      language: 'en',
      processing_status: 'ready',
      safety_status: 'passed',
      quiz_status: 'ready',
      tts_status: 'ready',
      can_read: true,
      can_edit: true,
      updated_at: '2026-06-10T16:45:00+08:00',
      difficulty_level: 'A2',
      library_id: 'lib_personal_001',
      library_name: '我的生物短文库',
      estimated_minutes: 3,
      content: 'Always start with the lowest magnification. Focus slowly and keep the lens clean after each use.',
    },
  ],
  lib_fr_001: [
    {
      id: 'mat_fr_001',
      title: 'Bonjour Paris',
      summary: 'A tiny French city guide for beginners.',
      language: 'fr',
      processing_status: 'ready',
      safety_status: 'passed',
      quiz_status: 'ready',
      tts_status: 'failed',
      can_read: true,
      can_edit: false,
      updated_at: '2026-06-09T12:00:00+08:00',
      difficulty_level: 'A1',
      library_id: 'lib_fr_001',
      library_name: '法语阅读练习库',
      estimated_minutes: 2,
      content: 'Paris est une ville tres connue. Beaucoup de visiteurs aiment marcher pres de la Seine et visiter les musees.',
    },
  ],
};

const WORDS = {
  w_001: {
    id: 'w_001',
    word_text: 'develop',
    meaning: '发展；形成',
    phonetic: '/dɪˈveləp/',
    pronunciation_audio: '/api/files/tts/words/develop.mp3',
    notebook_id: 'nb_en_default',
    language: 'en',
    example_sentence: 'Children develop language quickly.',
    review_stage: 'D3',
    next_review_at: '2026-06-10T09:00:00+08:00',
    wrong_count: 1,
  },
};

function findLibrary(libraryId) {
  return LIBRARIES.find((item) => item.id === libraryId) || LIBRARIES[0];
}

function getMaterialById(materialId) {
  return Object.values(MATERIALS)
    .flat()
    .find((item) => item.id === materialId);
}

function getSelectedLibrary() {
  return LIBRARIES[0];
}

function getSelectedNotebook() {
  return NOTEBOOKS[0];
}

function buildDashboard() {
  const selectedLibrary = getSelectedLibrary();
  return {
    today_status: {
      is_checked_in: false,
      completed_reading: false,
      completed_review: false,
      streak_days: 6,
    },
    selected_library: {
      id: selectedLibrary.id,
      name: selectedLibrary.name,
      material_count: selectedLibrary.material_count,
    },
    recommended_material: {
      id: 'mat_001',
      title: 'Why sleep matters',
      difficulty_level: 'B1',
      summary: 'A short article about sleep and memory.',
    },
    review_stats: {
      today_due: 8,
      new_words: 5,
      wrong_words: 3,
    },
    recent_materials: [
      {
        id: 'mat_002',
        title: 'Small daily habits',
        last_opened_at: '2026-06-09T08:20:00+08:00',
      },
      {
        id: 'mat_user_002',
        title: 'Microscope Basics',
        last_opened_at: '2026-06-08T20:00:00+08:00',
      },
    ],
  };
}

function buildQuiz(materialId) {
  return {
    material_id: materialId,
    questions: [
      {
        id: 'q1',
        type: 'single_choice',
        prompt: 'What is the main idea of the article?',
        options: ['Build stronger sleep habits', 'Travel to a new city', 'Learn advanced biology', 'Study with long sessions'],
      },
      {
        id: 'q2',
        type: 'single_choice',
        prompt: 'Which action helps improve learning quality?',
        options: ['Stable routine', 'Skip all breaks', 'Read only at midnight', 'Avoid all review'],
      },
      {
        id: 'q3',
        type: 'single_choice',
        prompt: 'What does the text connect with memory?',
        options: ['Sleep', 'Noise', 'Competition', 'Luck'],
      },
    ],
  };
}

function buildReviewQuestions(notebookId, bucket) {
  const prompts = {
    today: {
      word_id: 'w_001',
      review_type: 'listen_pick',
      audio_url: '/api/files/tts/words/develop.mp3',
      prompt: '你听到的是哪个词？',
      options: ['develop', 'device', 'detail'],
    },
    new: {
      word_id: 'w_010',
      review_type: 'meaning_choice',
      audio_url: null,
      prompt: 'tiny habit 的意思是？',
      options: ['微小习惯', '长期目标', '复杂系统'],
    },
    wrong: {
      word_id: 'w_020',
      review_type: 'sentence_fill',
      audio_url: null,
      prompt: 'Sleep helps the brain ____ memories.',
      options: ['store', 'break', 'cancel'],
    },
  };

  return {
    bucket,
    notebook_id: notebookId,
    session_id: `rv_${bucket}_${notebookId}`,
    questions: [prompts[bucket] || prompts.today],
    total: 5,
  };
}

export default class ELSController {
  constructor(db) {
    this.db = db;
  }

  async getDashboard(ctx) {
    ctx.success(buildDashboard());
  }

  async getRecommendedMaterials(ctx) {
    const libraryId = ctx.query.library_id || getSelectedLibrary().id;
    const items = (MATERIALS[libraryId] || MATERIALS.lib_public_default)
      .filter((item) => item.processing_status === 'ready' && item.can_read)
      .map((item) => ({
        id: item.id,
        library_id: item.library_id,
        library_name: item.library_name,
        title: item.title,
        difficulty_level: item.difficulty_level,
        summary: item.summary,
        estimated_minutes: item.estimated_minutes,
      }));
    ctx.success({ items });
  }

  async getMaterial(ctx) {
    const material = getMaterialById(ctx.params.materialId);
    if (!material) {
      ctx.error('ELS_NOT_FOUND', 404);
      return;
    }

    ctx.success({
      id: material.id,
      library_id: material.library_id,
      library_name: material.library_name,
      title: material.title,
      difficulty_level: material.difficulty_level,
      content: material.content,
      summary: material.summary,
      language: material.language,
      processing_status: material.processing_status,
      quiz_status: material.quiz_status,
      tts_status: material.tts_status,
      tts: {
        available: material.tts_status === 'ready',
        audio_url: material.tts_status === 'ready' ? `/api/files/tts/${material.id}.mp3` : null,
        speeds: [0.8, 1.0, 1.2],
      },
      progress: {
        is_read: false,
        collected_word_count: 0,
      },
    });
  }

  async getMaterialQuiz(ctx) {
    const material = getMaterialById(ctx.params.materialId);
    if (!material) {
      ctx.error('ELS_NOT_FOUND', 404);
      return;
    }
    ctx.success(buildQuiz(material.id));
  }

  async submitMaterialQuiz(ctx) {
    const answers = Array.isArray(ctx.request.body?.answers) ? ctx.request.body.answers : [];
    const correctCount = Math.min(answers.length, 2);

    ctx.success({
      correct_count: correctCount,
      total: 3,
      explanations: answers.map((item, index) => ({
        question_id: item.question_id || `q${index + 1}`,
        is_correct: index < correctCount,
        explanation: 'Mock 反馈：第一轮仅用于联调小测结果展示。',
      })),
      reading_completed: true,
      next_action: 'review_words',
    });
  }

  async getLibraries(ctx) {
    ctx.success({
      selected_library_id: getSelectedLibrary().id,
      items: LIBRARIES,
    });
  }

  async selectLibrary(ctx) {
    const selectedLibrary = findLibrary(ctx.request.body?.library_id);
    ctx.success({
      selected_library_id: selectedLibrary.id,
      selected_library_name: selectedLibrary.name,
    });
  }

  async getLibraryMaterials(ctx) {
    const library = findLibrary(ctx.params.libraryId);
    const items = (MATERIALS[library.id] || []).map((item) => ({
      id: item.id,
      title: item.title,
      summary: item.summary,
      language: item.language,
      processing_status: item.processing_status,
      safety_status: item.safety_status,
      quiz_status: item.quiz_status,
      tts_status: item.tts_status,
      can_read: item.can_read,
      can_edit: item.can_edit,
      updated_at: item.updated_at,
    }));

    ctx.success({
      library: {
        id: library.id,
        name: library.name,
        type: library.type,
      },
      items,
    });
  }

  async createMaterial(ctx) {
    const payload = ctx.request.body || {};
    ctx.success({
      id: 'mat_user_new_001',
      library_id: payload.library_id || 'lib_personal_001',
      title: payload.title || 'Untitled Material',
      source_type: 'user_upload',
      processing_status: 'pending_safety_review',
      safety_status: 'pending',
      quiz_status: 'pending',
      tts_status: 'pending',
      can_read: false,
    }, 'Created');
  }

  async updateMaterial(ctx) {
    const material = getMaterialById(ctx.params.materialId);
    if (!material) {
      ctx.error('ELS_NOT_FOUND', 404);
      return;
    }

    ctx.success({
      id: material.id,
      title: ctx.request.body?.title || material.title,
      summary: ctx.request.body?.summary || material.summary,
      processing_status: 'pending_safety_review',
      safety_status: 'pending',
      quiz_status: 'pending',
      tts_status: 'pending',
      can_read: false,
    }, 'Updated');
  }

  async getNotebooks(ctx) {
    ctx.success({
      selected_notebook_id: getSelectedNotebook().id,
      items: NOTEBOOKS,
    });
  }

  async selectNotebook(ctx) {
    const notebook = NOTEBOOKS.find((item) => item.id === ctx.request.body?.notebook_id) || getSelectedNotebook();
    ctx.success({
      selected_notebook_id: notebook.id,
      selected_notebook_name: notebook.name,
    });
  }

  async collectWord(ctx) {
    const material = getMaterialById(ctx.request.body?.material_id);
    if (!material) {
      ctx.error('ELS_NOT_FOUND', 404);
      return;
    }

    const notebook = NOTEBOOKS.find((item) => item.language === material.language) || getSelectedNotebook();

    ctx.success({
      word: {
        id: 'w_collect_001',
        word_text: ctx.request.body?.word_text || 'develop',
        meaning: material.language === 'fr' ? '发展；形成（法语词本示例）' : '发展；形成',
        phonetic: '/dɪˈveləp/',
        pronunciation_audio: '/api/files/tts/words/develop.mp3',
        sentence: ctx.request.body?.sentence || 'Children develop language quickly.',
        notebook_id: notebook.id,
        language: material.language,
        review_stage: 'D0',
      },
      already_exists: false,
    }, 'Created');
  }

  async getWord(ctx) {
    const word = WORDS[ctx.params.wordId];
    if (!word) {
      ctx.error('ELS_NOT_FOUND', 404);
      return;
    }
    ctx.success(word);
  }

  async getReviews(ctx) {
    const { bucket = 'today', notebook_id: notebookId, size = 5 } = ctx.query;
    if (!notebookId) {
      ctx.error('ELS_NOTEBOOK_EMPTY', 400);
      return;
    }

    ctx.success({
      ...buildReviewQuestions(notebookId, bucket),
      total: Number(size) || 5,
    });
  }

  async submitReviews(ctx) {
    const results = Array.isArray(ctx.request.body?.results) ? ctx.request.body.results : [];
    const correctCount = results.filter((item) => item.is_correct).length;
    ctx.success({
      session_summary: {
        correct_count: correctCount,
        total: results.length || 1,
        needs_repeat: Math.max((results.length || 1) - correctCount, 0),
      },
      review_stats: {
        today_due_remaining: 3,
        wrong_words: 2,
      },
      today_review_completed: true,
    });
  }

  async getCheckin(ctx) {
    ctx.success({
      is_checked_in: true,
      completed_reading: true,
      completed_review: false,
      streak_days: 7,
      day_type: 'reading_day',
    });
  }
}
