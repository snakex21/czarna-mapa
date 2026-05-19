import sqlite3, os, shutil

def normalize(s):
    r = {'ą':'a','ć':'c','ę':'e','ł':'l','ń':'n','ó':'o','ś':'s','ź':'z','ż':'z',
         'Ą':'A','Ć':'C','Ę':'E','Ł':'L','Ń':'N','Ó':'O','Ś':'S','Ź':'Z','Ż':'Z'}
    for k,v in r.items(): s = s.replace(k, v)
    return s.lower()

conn = sqlite3.connect(r'C:\Users\ASRock\Desktop\czarna-mapa\data\czarna.db')
conn.text_factory = str
rows = conn.execute('SELECT unikalny_klucz, nazwa_wlasciciela FROM wlasciciele').fetchall()

src_base = r'C:\Users\ASRock\Desktop\Projekt Mapa Czarna\backup\Czarna\protokoly'
dst_base = r'C:\Users\ASRock\Desktop\czarna-mapa\frontend\protokoly'

src_map = {}
for d in os.listdir(src_base):
    src_map[normalize(d)] = d

fixed = 0
for key, name in rows:
    key = key.strip()
    dst_path = os.path.join(dst_base, key)
    
    src_folder = src_map.get(normalize(name))
    if not src_folder:
        short = normalize(name.split('(')[0].strip())
        src_folder = src_map.get(short)
    if not src_folder:
        words = set(normalize(name).replace('_',' ').split())
        for nd, actual in src_map.items():
            dw = set(nd.replace('_',' ').split())
            if len(words & dw) >= 2:
                src_folder = actual
                break
    
    if src_folder and not os.path.exists(dst_path):
        os.makedirs(dst_path, exist_ok=True)
        src_path = os.path.join(src_base, src_folder)
        for f in os.listdir(src_path):
            shutil.copy2(os.path.join(src_path, f), os.path.join(dst_path, f))
        fixed += 1

print(f'Done: {fixed}/{len(rows)}')
conn.close()
