import sqlite3, os, shutil, unicodedata

def normalize(s):
    """Usuwa polskie znaki i upraszcza tekst"""
    replacements = {
        'ą': 'a', 'ć': 'c', 'ę': 'e', 'ł': 'l', 'ń': 'n',
        'ó': 'o', 'ś': 's', 'ź': 'z', 'ż': 'z',
        'Ą': 'A', 'Ć': 'C', 'Ę': 'E', 'Ł': 'L', 'Ń': 'N',
        'Ó': 'O', 'Ś': 'S', 'Ź': 'Z', 'Ż': 'Z',
    }
    for pl, ascii in replacements.items():
        s = s.replace(pl, ascii)
    return s.lower().strip()

conn = sqlite3.connect(r'C:\Users\ASRock\Desktop\czarna-mapa\data\czarna.db')
conn.text_factory = str
rows = conn.execute('SELECT unikalny_klucz, nazwa_wlasciciela FROM wlasciciele').fetchall()

src_base = r'C:\Users\ASRock\Desktop\Projekt Mapa Czarna\backup\Czarna\protokoly'
dst_base = r'C:\Users\ASRock\Desktop\czarna-mapa\frontend\protokoly'

src_folders = {}
for d in os.listdir(src_base):
    src_folders[normalize(d)] = d

fixed = 0
for key, name in rows:
    key_folder = key.replace(' ', '_')
    dst_path = os.path.join(dst_base, key_folder)
    
    # Szukaj: najpierw normalizowana pełna nazwa, potem bez nawiasów
    norm_name = normalize(name)
    norm_short = normalize(name.split('(')[0].strip())
    
    src_folder = src_folders.get(norm_name) or src_folders.get(norm_short)
    
    # Fuzzy: dopasuj po słowach kluczowych
    if not src_folder:
        name_words = set(norm_short.replace('_', ' ').split())
        for norm_dir, actual in src_folders.items():
            dir_words = set(norm_dir.replace('_', ' ').split())
            common = name_words & dir_words
            if len(common) >= 3 or (len(common) >= 2 and len(name_words) <= 3):
                src_folder = actual
                break
    
    if src_folder:
        src_path = os.path.join(src_base, src_folder)
        if not os.path.exists(dst_path):
            os.makedirs(dst_path, exist_ok=True)
            for f in os.listdir(src_path):
                shutil.copy2(os.path.join(src_path, f), os.path.join(dst_path, f))
        fixed += 1
    else:
        print(f'MISS: {name}')

print(f'\nFixed: {fixed}/{len(rows)}')
conn.close()
