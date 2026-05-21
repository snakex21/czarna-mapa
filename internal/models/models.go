package models

import "encoding/json"

// ============================================================================
// OBIEKT GEOGRAFICZNY (działka, droga, budynek)
// ============================================================================
type ObiektGeograficzny struct {
	ID               int64           `json:"id"`
	NazwaLubNumer    string          `json:"nazwa_lub_numer"`
	Kategoria        string          `json:"kategoria"`
	GeometriaGeoJSON json.RawMessage `json:"geometria_geojson"`
	BBoxMinLat       *float64        `json:"bbox_min_lat,omitempty"`
	BBoxMinLng       *float64        `json:"bbox_min_lng,omitempty"`
	BBoxMaxLat       *float64        `json:"bbox_max_lat,omitempty"`
	BBoxMaxLng       *float64        `json:"bbox_max_lng,omitempty"`
}

// ============================================================================
// WŁAŚCICIEL
// ============================================================================
type Wlasciciel struct {
	ID                    int64   `json:"id"`
	UnikalnyKlucz         string  `json:"unikalny_klucz"`
	NazwaWlasciciela      string  `json:"nazwa_wlasciciela"`
	NumerProtokolu        *int32  `json:"numer_protokolu,omitempty"`
	NumerDomu             *string `json:"numer_domu,omitempty"`
	DataProtokolu         *string `json:"data_protokolu,omitempty"`
	MiejsceProtokolu      *string `json:"miejsce_protokolu,omitempty"`
	Genealogia            *string `json:"genealogia,omitempty"`
	HistoriaWlasnosci     *string `json:"historia_wlasnosci,omitempty"`
	Uwagi                 *string `json:"uwagi,omitempty"`
	Wspolwlasnosc         *string `json:"wspolwlasnosc,omitempty"`
	PowiazaniaITransakcje *string `json:"powiazania_i_transakcje,omitempty"`
	InterpretacjaIWnioski *string `json:"interpretacja_i_wnioski,omitempty"`
}

// ============================================================================
// OSOBA GENEALOGICZNA
// ============================================================================
type OsobaGenealogia struct {
	ID           int64   `json:"id"`
	JsonID       int32   `json:"json_id"`
	ImieNazwisko string  `json:"imie_nazwisko"`
	Plec         *string `json:"plec,omitempty"`
	NumerDomu    *string `json:"numer_domu,omitempty"`
	RokUrodzenia *int32  `json:"rok_urodzenia,omitempty"`
	RokSmierci   *int32  `json:"rok_smierci,omitempty"`
	IdOjca       *int64  `json:"id_ojca,omitempty"`
	IdMatki      *int64  `json:"id_matki,omitempty"`
	IdProtokolu  *int64  `json:"id_protokolu,omitempty"`
	Uwagi        *string `json:"uwagi,omitempty"`
}

// ============================================================================
// MAŁŻEŃSTWO
// ============================================================================
type Malzenstwo struct {
	Malzonek1ID  int64   `json:"malzonek1_id"`
	Malzonek2ID  int64   `json:"malzonek2_id"`
	RokSlubu     *int32  `json:"rok_slubu,omitempty"`
	MiesiacSlubu *int32  `json:"miesiac_slubu,omitempty"`
	DzienSlubu   *int32  `json:"dzien_slubu,omitempty"`
	DataSlubu    *string `json:"data_slubu,omitempty"`
}

// ============================================================================
// DEMOGRAFIA
// ============================================================================
type Demografia struct {
	ID              int64   `json:"id"`
	Rok             int32   `json:"rok"`
	PopulacjaOgolem *int32  `json:"populacja_ogolem,omitempty"`
	Katolicy        *int32  `json:"katolicy,omitempty"`
	Zydzi           *int32  `json:"zydzi,omitempty"`
	Inni            *int32  `json:"inni,omitempty"`
	Opis            *string `json:"opis,omitempty"`
}

// ============================================================================
// KONFIGURACJA
// ============================================================================
type Konfiguracja struct {
	Klucz   string  `json:"klucz"`
	Wartosc string  `json:"wartosc"`
	Opis    *string `json:"opis,omitempty"`
}

// ============================================================================
// TYPY POMOCNICZE (odpowiedniki struktur z Rustowych komend)
// ============================================================================

// MapBounds — parametry zapytania o obiekty w widoku mapy
type MapBounds struct {
	SwLat float64
	SwLng float64
	NeLat float64
	NeLng float64
}

// DzialkaWlascicielInfo — informacja o przypisaniu działki do właściciela
type DzialkaWlascicielInfo struct {
	ObiektID         int64   `json:"obiekt_id"`
	WlascicielID     int64   `json:"wlasciciel_id"`
	NazwaWlasciciela string  `json:"nazwa_wlasciciela"`
	TypPosiadania    *string `json:"typ_posiadania,omitempty"`
}

// ProtokolInfo — informacja o protokole właściciela
type ProtokolInfo struct {
	Klucz            string  `json:"klucz"`
	Nazwa            string  `json:"nazwa"`
	NumerProtokolu   *int32  `json:"numer_protokolu,omitempty"`
	NumerDomu        *string `json:"numer_domu,omitempty"`
	DataProtokolu    *string `json:"data_protokolu,omitempty"`
	MiejsceProtokolu *string `json:"miejsce_protokolu,omitempty"`
	ZdjeciaCount     int32   `json:"zdjecia_count"`
}

// ZdjecieInfo — informacja o zdjęciu protokołu
type ZdjecieInfo struct {
	Nazwa   string `json:"nazwa"`
	Rozmiar int64  `json:"rozmiar"`
}

// DrzewoGenealogiczne — pełne drzewo
type DrzewoGenealogiczne struct {
	Osoby      []OsobaGenealogia `json:"osoby"`
	Malzenstwa []Malzenstwo      `json:"malzenstwa"`
}

// GenealogiaEditorPerson — płaski format zgodny ze starym edytorem genealogii.
type GenealogiaEditorPerson struct {
	IDOsoby       int64                    `json:"id_osoby"`
	DBID          int64                    `json:"db_id,omitempty"`
	Imie          string                   `json:"imie"`
	Nazwisko      string                   `json:"nazwisko"`
	RokUrodzenia  *int32                   `json:"rok_urodzenia,omitempty"`
	RokSmierci    *int32                   `json:"rok_smierci,omitempty"`
	IDOjca        *int64                   `json:"id_ojca,omitempty"`
	IDMatki       *int64                   `json:"id_matki,omitempty"`
	IDMalzonka    *int64                   `json:"id_malzonka,omitempty"`
	Marriages     []map[string]interface{} `json:"marriages,omitempty"`
	ProtokolKlucz string                   `json:"protokol_klucz,omitempty"`
	Plec          string                   `json:"plec"`
	NumerDomu     string                   `json:"numer_domu,omitempty"`
	Uwagi         string                   `json:"uwagi,omitempty"`
}

// DaneGraful — dane dla wizualizacji grafu powiązań
type DaneGraful struct {
	Nodes []map[string]interface{} `json:"nodes"`
	Edges []map[string]interface{} `json:"edges"`
}
