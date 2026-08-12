-- ELS 最小演示数据种子
-- 用于手动测试前的数据准备
-- 假设 system user id 为 'sys', 测试用户 user id 为 'test_user_001'

-- 1. 公共推荐库
INSERT IGNORE INTO app_els_libraries (id, owner_user_id, name, library_type, is_default, is_active)
VALUES ('lib_public_test', NULL, '公共推荐库', 'public', 1, 1);

-- 2. 测试用户个人库
INSERT IGNORE INTO app_els_libraries (id, owner_user_id, name, library_type, is_default, is_active)
VALUES ('lib_personal_test', 'test_user_001', '我的学习库', 'personal', 0, 1);

-- 3. 英语词本
INSERT IGNORE INTO app_els_notebooks (id, user_id, language, name, is_default)
VALUES ('nb_en_test', 'test_user_001', 'en', '英语词本', 1);

-- 4. 3 篇 ready 材料（公共库）
INSERT IGNORE INTO app_els_materials (id, library_id, owner_user_id, source_type, title, summary, content, language, processing_status, quiz_status, difficulty_level, published_at)
VALUES
('mat_ready_001', 'lib_public_test', NULL, 'curated', 'Why sleep matters',
 'A short article about sleep and memory.',
 'Sleep helps the brain store memories. Good sleep also improves attention, mood, and long-term learning performance. A short walk, less screen time at night, and a stable routine can all improve sleep quality.',
 'en', 'ready', 'ready', 'B1', NOW()),
('mat_ready_002', 'lib_public_test', NULL, 'curated', 'Small daily habits',
 'Tiny habits can shape long-term learning results.',
 'Daily learning does not need to be long. Reading for five minutes, repeating one sentence, and reviewing one mistake can already build a strong habit. Consistency matters more than duration.',
 'en', 'ready', 'ready', 'A2', NOW()),
('mat_ready_003', 'lib_public_test', NULL, 'passage', 'The power of reading',
 'Why reading regularly changes your brain.',
 'Research shows that people who read regularly have better memory, stronger analytical thinking skills, and improved focus. Even ten minutes of reading each day can make a measurable difference in cognitive performance over time.',
 'en', 'ready', 'ready', 'B2', NOW());

-- 5. 1 篇 processing 材料（个人库）
INSERT IGNORE INTO app_els_materials (id, library_id, owner_user_id, source_type, title, summary, content, language, processing_status, quiz_status)
VALUES
('mat_processing_001', 'lib_personal_test', 'test_user_001', 'user_upload', 'My Biology Note',
 'Short note about cell division.',
 'Cell division is the process by which a parent cell divides into two or more daughter cells.',
 'en', 'processing', 'pending');

-- 6. 1 篇 rejected 材料（个人库）
INSERT IGNORE INTO app_els_materials (id, library_id, owner_user_id, source_type, title, summary, content, language, processing_status, quiz_status, status_reason)
VALUES
('mat_rejected_001', 'lib_personal_test', 'test_user_001', 'user_upload', 'Test rejection',
 'Content that was rejected.',
 'This content contains inappropriate material for learning.',
 'en', 'rejected', 'pending', '内容包含不适合学习的敏感信息');

-- 7. 可复习词条（英语词本）
INSERT IGNORE INTO app_els_user_words (id, user_id, notebook_id, material_id, language, word_text, meaning, example_sentence, review_stage, next_review_at, wrong_count, is_in_wrong_bucket)
VALUES
('w_test_001', 'test_user_001', 'nb_en_test', 'mat_ready_001', 'en', 'develop', '发展；形成', 'Children develop language quickly.', 'D3', DATE_ADD(NOW(), INTERVAL -1 DAY), 1, 0),
('w_test_002', 'test_user_001', 'nb_en_test', 'mat_ready_001', 'en', 'routine', '常规；惯例', 'A stable routine improves learning quality.', 'D0', NULL, 0, 0),
('w_test_003', 'test_user_001', 'nb_en_test', 'mat_ready_001', 'en', 'memory', '记忆', 'Sleep helps the brain store memories.', 'D1', NOW(), 2, 1),
('w_test_004', 'test_user_001', 'nb_en_test', 'mat_ready_002', 'en', 'habit', '习惯', 'Tiny habits shape long-term learning.', 'D0', NULL, 0, 0),
('w_test_005', 'test_user_001', 'nb_en_test', 'mat_ready_003', 'en', 'focus', '专注；焦点', 'Reading improves focus.', 'D7', DATE_ADD(NOW(), INTERVAL 1 DAY), 0, 0);
