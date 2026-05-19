import sqlite3, re
conn = sqlite3.connect(r'C:\Users\ASRock\Desktop\czarna-mapa\data\czarna.db')
conn.text_factory = str
rows = conn.execute("SELECT unikalny_klucz, nazwa_wlasciciela, powiazania_i_transakcje FROM wlasciciele WHERE powiazania_i_transakcje IS NOT NULL AND powiazania_i_transakcje != '' LIMIT 5").fetchall()
print(f'Owners with powiazania: {len(rows)}')
for klucz, nazwa, text in rows:
    links = re.findall(r'\[\[.*?\|(.*?)\]\]', text or '')
    print(f'{nazwa}: {len(links)} links')
    if links:
        print(f'  Links: {links[:5]}')
        print(f'  Klucz: {klucz}')
    if text:
        print(f'  Text: {text[:200]}')
total = conn.execute("SELECT COUNT(*) FROM wlasciciele WHERE powiazania_i_transakcje IS NOT NULL AND powiazania_i_transakcje != ''").fetchone()[0]
all_owners = conn.execute("SELECT COUNT(*) FROM wlasciciele").fetchone()[0]
print(f'\nOwners with powiazania: {total} / {all_owners}')
conn.close()
