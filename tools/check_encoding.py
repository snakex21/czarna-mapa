import sqlite3
conn = sqlite3.connect(r'C:\Users\ASRock\Desktop\czarna-mapa\data\czarna.db')
conn.text_factory = str
row = conn.execute("SELECT genealogia FROM wlasciciele WHERE nazwa_wlasciciela LIKE 'Anna%'").fetchone()
if row and row[0]:
    text = row[0]
    polish = ['ą', 'ę', 'ł', 'ó', 'ś', 'ć', 'ź', 'ż', 'ń']
    for ch in polish:
        if ch in text:
            print(f'OK: "{ch}" found')
        else:
            print(f'MISSING: "{ch}"')
    print()
    print('First 100 chars:', repr(text[:100]))
else:
    print('NO DATA')
conn.close()
