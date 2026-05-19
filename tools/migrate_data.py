"""
================================================================================
MIGRACJA DANYCH: PostgreSQL + JSON → SQLite
================================================================================
Narzędzie do migracji danych z istniejącej bazy PostgreSQL i plików JSON
do nowej bazy SQLite dla aplikacji Tauri.
================================================================================
"""

import json
import sqlite3
import os
import sys
import math
from pathlib import Path

# Ścieżki
BASE_DIR = Path(r"C:\Users\ASRock\Desktop\Projekt Mapa Czarna")
BACKUP_DIR = BASE_DIR / "backup" / "Czarna"
SQLITE_DB_PATH = Path(r"C:\Users\ASRock\Desktop\czarna-mapa\data\czarna.db")

def connect_sqlite():
    """Tworzy połączenie z SQLite i inicjalizuje schemat."""
    conn = sqlite3.connect(str(SQLITE_DB_PATH))
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn

def create_schema(conn):
    """Tworzy tabele w SQLite."""
    schema = """
    CREATE TABLE IF NOT EXISTS konfiguracja_systemu (
        klucz TEXT PRIMARY KEY,
        wartosc TEXT NOT NULL,
        opis TEXT
    );

    CREATE TABLE IF NOT EXISTS obiekty_geograficzne (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nazwa_lub_numer TEXT NOT NULL,
        kategoria TEXT NOT NULL,
        geometria_geojson TEXT,
        bbox_min_lat REAL,
        bbox_min_lng REAL,
        bbox_max_lat REAL,
        bbox_max_lng REAL,
        UNIQUE (nazwa_lub_numer, kategoria)
    );

    CREATE TABLE IF NOT EXISTS wlasciciele (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        unikalny_klucz TEXT NOT NULL UNIQUE,
        nazwa_wlasciciela TEXT NOT NULL,
        numer_protokolu INTEGER,
        numer_domu TEXT,
        data_protokolu TEXT,
        miejsce_protokolu TEXT,
        genealogia TEXT,
        historia_wlasnosci TEXT,
        uwagi TEXT,
        wspolwlasnosc TEXT,
        powiazania_i_transakcje TEXT,
        interpretacja_i_wnioski TEXT
    );

    CREATE TABLE IF NOT EXISTS osoby_genealogia (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        json_id INTEGER UNIQUE NOT NULL,
        imie_nazwisko TEXT NOT NULL,
        plec TEXT,
        numer_domu TEXT,
        rok_urodzenia INTEGER,
        rok_smierci INTEGER,
        id_ojca INTEGER REFERENCES osoby_genealogia(id) ON DELETE SET NULL,
        id_matki INTEGER REFERENCES osoby_genealogia(id) ON DELETE SET NULL,
        id_protokolu INTEGER REFERENCES wlasciciele(id) ON DELETE SET NULL,
        uwagi TEXT
    );

    CREATE TABLE IF NOT EXISTS malzenstwa (
        malzonek1_id INTEGER NOT NULL REFERENCES osoby_genealogia(id) ON DELETE CASCADE,
        malzonek2_id INTEGER NOT NULL REFERENCES osoby_genealogia(id) ON DELETE CASCADE,
        rok_slubu INTEGER,
        miesiac_slubu INTEGER,
        dzien_slubu INTEGER,
        data_slubu TEXT,
        PRIMARY KEY (malzonek1_id, malzonek2_id),
        CHECK (malzonek1_id <> malzonek2_id)
    );

    CREATE TABLE IF NOT EXISTS dzialki_wlasciciele (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        wlasciciel_id INTEGER NOT NULL REFERENCES wlasciciele(id) ON DELETE CASCADE,
        obiekt_id INTEGER NOT NULL REFERENCES obiekty_geograficzne(id) ON DELETE CASCADE,
        typ_posiadania TEXT,
        opis_udzialu TEXT,
        UNIQUE (wlasciciel_id, obiekt_id, typ_posiadania)
    );

    CREATE TABLE IF NOT EXISTS demografia (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        rok INTEGER NOT NULL UNIQUE,
        populacja_ogolem INTEGER,
        katolicy INTEGER,
        zydzi INTEGER,
        inni INTEGER,
        opis TEXT
    );

    CREATE TABLE IF NOT EXISTS powiazania_protokolow (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        wlasciciel_id_1 INTEGER NOT NULL REFERENCES wlasciciele(id) ON DELETE CASCADE,
        wlasciciel_id_2 INTEGER NOT NULL REFERENCES wlasciciele(id) ON DELETE CASCADE,
        typ_relacji TEXT,
        opis_relacji TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_obiekty_bbox
        ON obiekty_geograficzne(bbox_min_lat, bbox_min_lng, bbox_max_lat, bbox_max_lng);
    CREATE INDEX IF NOT EXISTS idx_obiekty_kategoria ON obiekty_geograficzne(kategoria);
    CREATE INDEX IF NOT EXISTS idx_wlasciciele_nazwa ON wlasciciele(nazwa_wlasciciela);
    CREATE INDEX IF NOT EXISTS idx_osoby_protokol ON osoby_genealogia(id_protokolu);
    CREATE INDEX IF NOT EXISTS idx_osoby_ojciec ON osoby_genealogia(id_ojca);
    CREATE INDEX IF NOT EXISTS idx_osoby_matka ON osoby_genealogia(id_matki);
    CREATE INDEX IF NOT EXISTS idx_dzialki_wlasciciel ON dzialki_wlasciciele(wlasciciel_id);
    CREATE INDEX IF NOT EXISTS idx_dzialki_obiekt ON dzialki_wlasciciele(obiekt_id);
    """
    conn.executescript(schema)
    conn.commit()

def import_map_config(conn):
    """Importuje konfigurację mapy."""
    config_path = BACKUP_DIR / "map_config.json"
    if not config_path.exists():
        print("[!]  Brak map_config.json")
        return

    with open(config_path, encoding='utf-8') as f:
        config = json.load(f)

    conn.execute(
        "INSERT OR REPLACE INTO konfiguracja_systemu (klucz, wartosc, opis) VALUES (?, ?, ?)",
        ('map_calibration', json.dumps(config['calibration']), 'Współrzędne kalibracji mapy')
    )
    conn.execute(
        "INSERT OR REPLACE INTO konfiguracja_systemu (klucz, wartosc, opis) VALUES (?, ?, ?)",
        ('map_defaults', json.dumps(config['defaults']), 'Domyślny widok mapy')
    )
    print("[OK] Konfiguracja mapy zaimportowana")

def calculate_bbox(coords):
    """Oblicza bounding box z listy współrzędnych [[lat, lng], ...]."""
    if not coords or not isinstance(coords, list) or len(coords) == 0:
        return None, None, None, None

    # Polygon format: [[lat, lng], ...]
    if isinstance(coords[0], list):
        lats = [c[0] for c in coords if isinstance(c, list) and len(c) >= 2]
        lngs = [c[1] for c in coords if isinstance(c, list) and len(c) >= 2]
    # Point format: [lat, lng]
    elif len(coords) >= 2 and isinstance(coords[0], (int, float)):
        lats = [coords[0]]
        lngs = [coords[1]]
    else:
        return None, None, None, None

    if not lats:
        return None, None, None, None
    return min(lats), min(lngs), max(lats), max(lngs)

def import_parcels(conn):
    """Importuje działki z parcels_data.json."""
    parcels_path = BACKUP_DIR / "parcels_data.json"
    if not parcels_path.exists():
        print("[!]  Brak parcels_data.json")
        return

    with open(parcels_path, encoding='utf-8') as f:
        parcels = json.load(f)

    count = 0
    for key, data in parcels.items():
        nazwa = key.split('_')[0]  # np. "1154" z "1154_rolna"
        kategoria = data.get('kategoria', 'nieznana')
        geometria = data.get('geometria', [])

        # Konwertuj geometrię na GeoJSON z właściwym typem
        try:
            if geometria and isinstance(geometria, list) and len(geometria) > 0:
                if isinstance(geometria[0], list):
                    # Wielokąt lub linia: [[lat, lng], [lat, lng], ...]
                    is_line = kategoria in ('droga', 'rzeka', 'woda', 'strumien', 'sciezka')
                    
                    if is_line:
                        # Linia (droga, rzeka) - nie zamykamy
                        geojson_coords = [[c[1], c[0]] for c in geometria]
                        geojson = json.dumps({
                            "type": "LineString",
                            "coordinates": geojson_coords
                        })
                    else:
                        # Obszar (działka, budynek, las...) -> Polygon
                        # Domknij pierścień jeśli trzeba
                        coords = [[c[1], c[0]] for c in geometria]
                        if coords[0] != coords[-1]:
                            coords.append(coords[0])  # domknij
                        geojson = json.dumps({
                            "type": "Polygon",
                            "coordinates": [coords]
                        })
                    bbox_min_lat, bbox_min_lng, bbox_max_lat, bbox_max_lng = calculate_bbox(geometria)
                elif len(geometria) >= 2 and isinstance(geometria[0], (int, float)):
                    # Point: [lat, lng]
                    lat, lng = geometria[0], geometria[1]
                    geojson = json.dumps({
                        "type": "Point",
                        "coordinates": [lng, lat]
                    })
                    bbox_min_lat = bbox_max_lat = lat
                    bbox_min_lng = bbox_max_lng = lng
                else:
                    geojson = None
                    bbox_min_lat = bbox_min_lng = bbox_max_lat = bbox_max_lng = None
            else:
                geojson = None
                bbox_min_lat = bbox_min_lng = bbox_max_lat = bbox_max_lng = None
        except Exception as e:
            print(f"[!] Blad geometrii dla {key}: {e}")
            geojson = None
            bbox_min_lat = bbox_min_lng = bbox_max_lat = bbox_max_lng = None

        try:
            conn.execute(
                """INSERT INTO obiekty_geograficzne
                   (nazwa_lub_numer, kategoria, geometria_geojson,
                    bbox_min_lat, bbox_min_lng, bbox_max_lat, bbox_max_lng)
                   VALUES (?, ?, ?, ?, ?, ?, ?)""",
                (nazwa, kategoria, geojson,
                 bbox_min_lat, bbox_min_lng, bbox_max_lat, bbox_max_lng)
            )
            count += 1
        except sqlite3.IntegrityError:
            pass  # Duplikat - pomiń

    conn.commit()
    print(f"[OK] Zaimportowano {count} działek")

def import_owners_and_links(conn):
    """Importuje właścicieli i powiązania właściciel-działka."""
    owners_path = BACKUP_DIR / "owner_data_to_import.json"
    if not owners_path.exists():
        print("[!]  Brak owner_data_to_import.json")
        return

    with open(owners_path, encoding='utf-8') as f:
        owners = json.load(f)

    owner_count = 0
    link_count = 0

    for key, data in owners.items():
        nazwa = data.get('ownerName', key)
        numer_protokolu = data.get('orderNumber')
        numer_domu = data.get('houseNumber')
        data_protokolu = data.get('protocolDate')
        miejsce = data.get('protocolLocation')
        genealogia = data.get('genealogy', '')
        historia = data.get('ownershipHistory', '')
        uwagi = data.get('remarks', '')
        wspolwl = data.get('wspolwlasnosc', '')
        powiazania = data.get('powiazania_i_transakcje', '')
        interpretacja = data.get('interpretacja_i_wnioski', '')

        # Użyj KLUCZA JSON jako unikalny_klucz (potrzebne dla grafu)
        unikalny_klucz = key

        try:
            conn.execute(
                """INSERT INTO wlasciciele
                   (unikalny_klucz, nazwa_wlasciciela, numer_protokolu, numer_domu,
                    data_protokolu, miejsce_protokolu,
                    genealogia, historia_wlasnosci, uwagi, wspolwlasnosc,
                    powiazania_i_transakcje, interpretacja_i_wnioski)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (unikalny_klucz, nazwa,
                 int(numer_protokolu) if numer_protokolu else None,
                 numer_domu, data_protokolu, miejsce,
                 genealogia or None, historia or None, uwagi or None,
                 wspolwl or None, powiazania or None, interpretacja or None)
            )
            wlasciciel_id = conn.execute("SELECT last_insert_rowid()").fetchone()[0]
            owner_count += 1

            # Powiązania z działkami - PROTOKOLOWE (wszystkie)
            for kategoria, ploty in [('budowlana', data.get('buildingPlots', [])),
                                      ('rolna', data.get('agriculturalPlots', [])),
                                      ('laka', data.get('meadowPlots', [])),
                                      ('pastwisko', data.get('pasturePlots', [])),
                                      ('las', data.get('forestPlots', []))]:
                if not ploty:
                    continue
                for plot in ploty:
                    if isinstance(plot, dict):
                        nazwa_dzialki = str(plot.get('numerator', ''))
                    else:
                        nazwa_dzialki = str(plot)

                    obiekt = conn.execute(
                        "SELECT id FROM obiekty_geograficzne WHERE nazwa_lub_numer = ? AND kategoria = ?",
                        (nazwa_dzialki, kategoria)
                    ).fetchone()

                    if obiekt:
                        try:
                            conn.execute(
                                "INSERT OR IGNORE INTO dzialki_wlasciciele (wlasciciel_id, obiekt_id, typ_posiadania) VALUES (?, ?, NULL)",
                                (wlasciciel_id, obiekt[0])
                            )
                            link_count += 1
                        except sqlite3.IntegrityError:
                            pass

            # Powiązania RZECZYWISTE - update istniejących lub dodaj nowe
            for kategoria, ploty in [('budowlana', data.get('realbuildingPlots', [])),
                                      ('rolna', data.get('realagriculturalPlots', []))]:
                if not ploty:
                    continue
                for plot in ploty:
                    if isinstance(plot, dict):
                        nazwa_dzialki = str(plot.get('numerator', ''))
                    else:
                        nazwa_dzialki = str(plot)

                    obiekt = conn.execute(
                        "SELECT id FROM obiekty_geograficzne WHERE nazwa_lub_numer = ? AND kategoria = ?",
                        (nazwa_dzialki, kategoria)
                    ).fetchone()

                    if obiekt:
                        try:
                            # INSERT OR REPLACE - jeśli istnieje, aktualizuje typ
                            conn.execute(
                                "INSERT OR REPLACE INTO dzialki_wlasciciele (wlasciciel_id, obiekt_id, typ_posiadania) VALUES (?, ?, 'wlasnosc rzeczywista')",
                                (wlasciciel_id, obiekt[0])
                            )
                        except sqlite3.IntegrityError:
                            pass

        except sqlite3.IntegrityError as e:
            print(f"[!]  Pominięto {nazwa}: {e}")

    conn.commit()
    print(f"[OK] Zaimportowano {owner_count} właścicieli i {link_count} powiązań")

def import_demography(conn):
    """Importuje dane demograficzne."""
    demo_path = BACKUP_DIR / "demografia.json"
    if not demo_path.exists():
        print("[!]  Brak demografia.json")
        return

    with open(demo_path, encoding='utf-8') as f:
        data = json.load(f)

    count = 0
    for d in data:
        try:
            conn.execute(
                "INSERT INTO demografia (rok, populacja_ogolem, katolicy, zydzi, inni, opis) VALUES (?, ?, ?, ?, ?, ?)",
                (d['rok'], d.get('populacja_ogolem'), d.get('katolicy'),
                 d.get('zydzi'), d.get('inni'), d.get('opis', ''))
            )
            count += 1
        except sqlite3.IntegrityError:
            pass

    conn.commit()
    print(f"[OK] Zaimportowano {count} wpisów demograficznych")

def import_genealogy(conn):
    """Importuje dane genealogiczne (osoby i małżeństwa)."""
    gen_path = BACKUP_DIR / "genealogia.json"
    if not gen_path.exists():
        print("[!]  Brak geneologia.json")
        return

    with open(gen_path, encoding='utf-8') as f:
        data = json.load(f)

    persons = data.get('persons', [])
    if not persons:
        print("[!]  Brak osób w danych genealogicznych")
        return

    # Mapowanie json_id → sqlite_id
    id_map = {}

    # Krok 1: Importuj wszystkie osoby (bez rodziców)
    for person in persons:
        json_id = person['id']
        name = person.get('name', 'Nieznany/a')
        gender = person.get('gender', '')
        house = person.get('houseNumber', '')
        birth = person.get('birthDate', {})
        death = person.get('deathDate', {})
        notes = person.get('notes', '')

        rok_ur = birth.get('year') if birth else None
        rok_sm = death.get('year') if death else None

        try:
            conn.execute(
                """INSERT INTO osoby_genealogia
                   (json_id, imie_nazwisko, plec, numer_domu, rok_urodzenia, rok_smierci, uwagi)
                   VALUES (?, ?, ?, ?, ?, ?, ?)""",
                (json_id, name, gender, house, rok_ur, rok_sm, notes)
            )
            sqlite_id = conn.execute("SELECT last_insert_rowid()").fetchone()[0]
            id_map[json_id] = sqlite_id
        except sqlite3.IntegrityError:
            pass

    print(f"[OK] Zaimportowano {len(id_map)} osób")

    # Krok 2: Ustaw rodziców
    for person in persons:
        json_id = person['id']
        sqlite_id = id_map.get(json_id)
        if not sqlite_id:
            continue

        father_json_id = person.get('fatherId')
        mother_json_id = person.get('motherId')

        if father_json_id or mother_json_id:
            father_sqlite = id_map.get(father_json_id) if father_json_id else None
            mother_sqlite = id_map.get(mother_json_id) if mother_json_id else None

            if father_sqlite or mother_sqlite:
                conn.execute(
                    "UPDATE osoby_genealogia SET id_ojca = ?, id_matki = ? WHERE id = ?",
                    (father_sqlite, mother_sqlite, sqlite_id)
                )

    # Krok 3: Importuj małżeństwa
    marriage_count = 0
    for person in persons:
        json_id = person['id']
        sqlite_id = id_map.get(json_id)
        if not sqlite_id:
            continue

        for marriage in person.get('marriages', []):
            spouse_json_id = marriage.get('spouseId')
            spouse_sqlite_id = id_map.get(spouse_json_id)
            if not spouse_sqlite_id:
                continue

            date = marriage.get('date', {})
            rok = date.get('year')

            # Dodaj tylko raz na parę (mniejszy ID pierwszy)
            m1, m2 = sorted([sqlite_id, spouse_sqlite_id])
            try:
                conn.execute(
                    "INSERT INTO malzenstwa (malzonek1_id, malzonek2_id, rok_slubu) VALUES (?, ?, ?)",
                    (m1, m2, rok)
                )
                marriage_count += 1
            except sqlite3.IntegrityError:
                pass

    conn.commit()
    print(f"[OK] Zaimportowano {marriage_count} małżeństw")

def import_from_postgresql(conn):
    """Próbuje zaimportować dodatkowe dane z PostgreSQL."""
    try:
        import psycopg2
        from dotenv import dotenv_values

        pg_config_path = BASE_DIR / "backend" / ".postgres.env"
        if not pg_config_path.exists():
            print("[i]  Brak konfiguracji PostgreSQL (.postgres.env) — pomijam")
            return

        pg_config = dotenv_values(str(pg_config_path))
        pg_conn = psycopg2.connect(
            host=pg_config.get('LAUNCHER_DB_HOST', 'localhost'),
            port=int(pg_config.get('LAUNCHER_DB_PORT', 5432)),
            user=pg_config.get('LAUNCHER_DB_USER', 'postgres'),
            password=pg_config.get('LAUNCHER_DB_PASSWORD', ''),
            database='mapa_czarna_db'
        )

        cursor = pg_conn.cursor()

        # Importuj dane z wlasciciele (z dodatkowymi polami)
        cursor.execute("SELECT * FROM wlasciciele")
        columns = [desc[0] for desc in cursor.description]
        rows = cursor.fetchall()

        for row in rows:
            data = dict(zip(columns, row))
            sqlite_id = conn.execute(
                "SELECT id FROM wlasciciele WHERE unikalny_klucz = ?",
                (data['unikalny_klucz'],)
            ).fetchone()

            if sqlite_id:
                conn.execute(
                    """UPDATE wlasciciele SET
                       genealogia = ?, historia_wlasnosci = ?,
                       uwagi = ?, wspolwlasnosc = ?,
                       powiazania_i_transakcje = ?, interpretacja_i_wnioski = ?
                       WHERE id = ?""",
                    (data.get('genealogia'), data.get('historia_wlasnosci'),
                     data.get('uwagi'), data.get('wspolwlasnosc'),
                     data.get('powiazania_i_transakcje'), data.get('interpretacja_i_wnioski'),
                     sqlite_id[0])
                )

        cursor.close()
        pg_conn.close()
        print("[OK] Dodatkowe dane z PostgreSQL zaimportowane")

    except ImportError:
        print("[i]  psycopg2 niedostępny — pomijam import z PostgreSQL")
    except Exception as e:
        print(f"[!]  Błąd importu z PostgreSQL: {e}")

def main():
    print("=" * 60)
    print("MIGRACJA DANYCH -> SQLite")
    print("=" * 60)

    # Upewnij się że katalog data istnieje
    SQLITE_DB_PATH.parent.mkdir(parents=True, exist_ok=True)

    conn = connect_sqlite()

    print("\n1. Tworzę schemat bazy...")
    create_schema(conn)

    print("\n2. Importuję konfigurację mapy...")
    import_map_config(conn)

    print("\n3. Importuję działki (geometria)...")
    import_parcels(conn)

    print("\n4. Importuję właścicieli i powiązania...")
    import_owners_and_links(conn)

    print("\n5. Importuję dane demograficzne...")
    import_demography(conn)

    print("\n6. Importuję genealogię (osoby + małżeństwa)...")
    import_genealogy(conn)

    print("\n7. Importuję dodatkowe dane z PostgreSQL...")
    import_from_postgresql(conn)

    conn.close()

    print("\n" + "=" * 60)
    print("MIGRACJA ZAKONCZONA!")
    print(f"   Baza danych: {SQLITE_DB_PATH}")
    print(f"   Rozmiar: {SQLITE_DB_PATH.stat().st_size / 1024 / 1024:.1f} MB")
    print("=" * 60)

if __name__ == '__main__':
    main()
