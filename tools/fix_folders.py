import sqlite3, os, shutil, sys
sys.stdout.reconfigure(encoding='utf-8')

conn = sqlite3.connect(r'C:\Users\ASRock\Desktop\czarna-mapa\data\czarna.db')
conn.text_factory = str
rows = conn.execute('SELECT unikalny_klucz, nazwa_wlasciciela FROM wlasciciele').fetchall()

src_base = r'C:\Users\ASRock\Desktop\Projekt Mapa Czarna\backup\Czarna\protokoly'
dst_base = r'C:\Users\ASRock\Desktop\czarna-mapa\frontend\protokoly'

# Lista wszystkich folderów źródłowych
src_folders = {}
for d in os.listdir(src_base):
    src_folders[d] = os.path.join(src_base, d)

fixed = 0
missing = 0
for key, name in rows:
    src_folder = name.replace(' ', '_')
    dst_folder = key.replace(' ', '_')
    dst_path = os.path.join(dst_base, dst_folder)
    
    if src_folder in src_folders:
        os.makedirs(dst_path, exist_ok=True)
        src_path = src_folders[src_folder]
        for f in os.listdir(src_path):
            shutil.copy2(os.path.join(src_path, f), os.path.join(dst_path, f))
        fixed += 1
    else:
        missing += 1
        if missing <= 10:
            print(f'MISSING: {repr(name)} -> folder: {repr(src_folder)}')

print(f'\nFixed: {fixed}, Missing: {missing}')
conn.close()
