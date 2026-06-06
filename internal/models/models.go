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
// PUNKT HISTORYCZNY (obiekt specjalny z metadanymi + galerią zdjęć)
// ============================================================================
//
// Wzorzec z "Projekt Mapa Czarna" (FastAPI). Tabela obiekty_geograficzne
// pozostaje kanonicznym źródłem geometrii (object_name = nazwa_lub_numer).
// historical_points_metadata trzyma display_name / description / source_note.
// point_photos to galeria (każdy obiekt może mieć 0..N zdjęć z captionem).
//
// Wszystkie trzy warstwy są łączone w PobierzPunktyHistoryczne(), żeby zwrócić
// FeatureCollection dla mapy i osobno dla admina.

// HistoricalPointMetadata — metadane opisowe punktu historycznego.
// Powiązanie: object_name = obiekty_geograficzne.nazwa_lub_numer (gdzie kategoria='obiekt_specjalny').
type HistoricalPointMetadata struct {
	ObjectName  string `json:"object_name"`
	DisplayName string `json:"display_name"`
	Description string `json:"description"`
	SourceNote  string `json:"source_note"`
}

// PointPhoto — jedno zdjęcie w galerii punktu historycznego.
type PointPhoto struct {
	ID         int64  `json:"id"`
	ObjectName string `json:"object_name"`
	Filename   string `json:"filename"`
	Caption    string `json:"caption"`
	Position   int    `json:"position"`
	CreatedAt  string `json:"created_at"`
}

// HistoricalPoint — pełny obiekt dla admina (z galerią) — do edytora.
type HistoricalPoint struct {
	ObjectName  string       `json:"object_name"`
	DisplayName string       `json:"display_name"`
	Description string       `json:"description"`
	SourceNote  string       `json:"source_note"`
	Photos      []PointPhoto `json:"photos"`
}

// HistoricalPointFeature — feature GeoJSON dla warstwy mapy (bez pełnej listy
// zdjęć — ta jest pobierana leniwie albo inline jeśli mała). Pola flat do
// bezpośredniego użycia w properties GeoJSON.
type HistoricalPointFeature struct {
	Type        string         `json:"type"`        // "Feature"
	Geometry    json.RawMessage `json:"geometry"`    // Point
	Properties  json.RawMessage `json:"properties"`  // patrz HistoricalPointProperties
	ID          int64          `json:"id"`
}

// HistoricalPointProperties — properties dla warstwy mapy.
// photos jest zserializowane jako string (MapLibre trzyma to jako string).
type HistoricalPointProperties struct {
	ObjectName  string             `json:"object_name"`
	DisplayName string             `json:"display_name"`
	Description string             `json:"description"`
	SourceNote  string             `json:"source_note"`
	Photos      []PointPhotoInline `json:"photos"`
}

// PointPhotoInline — uproszczone pole zdjęcia w properties (bez created_at).
type PointPhotoInline struct {
	Filename string `json:"filename"`
	Caption  string `json:"caption"`
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
