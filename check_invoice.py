import sqlite3

conn = sqlite3.connect('data/touwaka.db')
cursor = conn.cursor()

# 查看所有表
cursor.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
print('=== 所有表 ===')
for row in cursor.fetchall():
    print(row[0])

conn.close()