import pymysql
import json

conn = pymysql.connect(host='localhost', user='touwaka', password='123456', database='touwaka_mate')
cursor = conn.cursor()

# 查看当前白名单配置
cursor.execute("SELECT setting_key, setting_value FROM system_settings WHERE setting_key = 'allowed_node_modules'")
row = cursor.fetchone()

if row:
    print(f'Current allowed_node_modules: {row[1]}')
    # 更新白名单，添加 pdfjs-dist
    current = json.loads(row[1]) if row[1] else []
    if 'pdfjs-dist' not in current:
        current.append('pdfjs-dist')
        cursor.execute("UPDATE system_settings SET setting_value = %s WHERE setting_key = 'allowed_node_modules'", 
                      (json.dumps(current),))
        conn.commit()
        print(f'Updated allowed_node_modules: {current}')
    else:
        print('pdfjs-dist already in whitelist')
else:
    # 插入新��白名单配置
    cursor.execute("INSERT INTO system_settings (setting_key, setting_value, description, created_at, updated_at) VALUES ('allowed_node_modules', %s, 'Node.js允许的npm包列表', NOW(), NOW())", 
                   (json.dumps(['pdfjs-dist']),))
    conn.commit()
    print('Inserted new allowed_node_modules with pdfjs-dist')

# 验证
cursor.execute("SELECT setting_value FROM system_settings WHERE setting_key = 'allowed_node_modules'")
row = cursor.fetchone()
if row:
    print(f'Result: {row[0]}')

conn.close()