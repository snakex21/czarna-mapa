package geo

import (
	"encoding/json"
	"math"
)

// ============================================================================
// BOUNDING BOX
// ============================================================================

// BBox reprezentuje bounding box: [minLng, minLat, maxLng, maxLat]
type BBox [4]float64

// CalculateBBox oblicza bounding box z surowego GeoJSON stringa.
func CalculateBBox(geojsonStr string) *BBox {
	var minLat, minLng = math.MaxFloat64, math.MaxFloat64
	var maxLat, maxLng = -math.MaxFloat64, -math.MaxFloat64

	extractCoords(geojsonStr, &minLat, &minLng, &maxLat, &maxLng)

	if minLat == math.MaxFloat64 {
		return nil
	}
	return &BBox{minLng, minLat, maxLng, maxLat}
}

func extractCoords(geojsonStr string, minLat, minLng, maxLat, maxLng *float64) {
	var raw map[string]interface{}
	if err := json.Unmarshal([]byte(geojsonStr), &raw); err != nil {
		return
	}
	extractFromJSON(raw, minLat, minLng, maxLat, maxLng)
}

func extractFromJSON(v interface{}, minLat, minLng, maxLat, maxLng *float64) {
	switch val := v.(type) {
	case map[string]interface{}:
		if t, ok := val["type"].(string); ok {
			switch t {
			case "Feature":
				if geom, ok := val["geometry"]; ok {
					extractFromJSON(geom, minLat, minLng, maxLat, maxLng)
				}
			case "Point":
				if coords, ok := val["coordinates"].([]interface{}); ok && len(coords) >= 2 {
					lng, lat := toFloat(coords[0]), toFloat(coords[1])
					updateBBox(lat, lng, minLat, minLng, maxLat, maxLng)
				}
			case "MultiPoint", "LineString":
				if coords, ok := val["coordinates"].([]interface{}); ok {
					for _, c := range coords {
						if cc, ok := c.([]interface{}); ok && len(cc) >= 2 {
							updateBBox(toFloat(cc[1]), toFloat(cc[0]), minLat, minLng, maxLat, maxLng)
						}
					}
				}
			case "MultiLineString", "Polygon":
				if coords, ok := val["coordinates"].([]interface{}); ok {
					for _, ring := range coords {
						if r, ok := ring.([]interface{}); ok {
							for _, c := range r {
								if cc, ok := c.([]interface{}); ok && len(cc) >= 2 {
									updateBBox(toFloat(cc[1]), toFloat(cc[0]), minLat, minLng, maxLat, maxLng)
								}
							}
						}
					}
				}
			case "MultiPolygon":
				if coords, ok := val["coordinates"].([]interface{}); ok {
					for _, poly := range coords {
						if p, ok := poly.([]interface{}); ok {
							for _, ring := range p {
								if r, ok := ring.([]interface{}); ok {
									for _, c := range r {
										if cc, ok := c.([]interface{}); ok && len(cc) >= 2 {
											updateBBox(toFloat(cc[1]), toFloat(cc[0]), minLat, minLng, maxLat, maxLng)
										}
									}
								}
							}
						}
					}
				}
			case "GeometryCollection":
				if geoms, ok := val["geometries"].([]interface{}); ok {
					for _, g := range geoms {
						extractFromJSON(g, minLat, minLng, maxLat, maxLng)
					}
				}
			}
		}
		// Rekurencyjnie przeszukaj wszystkie pola
		for _, vv := range val {
			extractFromJSON(vv, minLat, minLng, maxLat, maxLng)
		}
	case []interface{}:
		for _, item := range val {
			extractFromJSON(item, minLat, minLng, maxLat, maxLng)
		}
	}
}

func updateBBox(lat, lng float64, minLat, minLng, maxLat, maxLng *float64) {
	if lat < *minLat { *minLat = lat }
	if lat > *maxLat { *maxLat = lat }
	if lng < *minLng { *minLng = lng }
	if lng > *maxLng { *maxLng = lng }
}

func toFloat(v interface{}) float64 {
	switch n := v.(type) {
	case float64: return n
	case json.Number:
		f, _ := n.Float64()
		return f
	}
	return 0
}

// ============================================================================
// POLYGON FROM GEOJSON
// ============================================================================

// Point reprezentuje punkt 2D
type Point struct{ Lng, Lat float64 }

// Polygon reprezentuje wielokąt
type Polygon struct {
	Exterior  []Point
	Interiors [][]Point
}

// ParsePolygonFromGeoJSON parsuje string GeoJSON i zwraca Polygon.
// Obsługuje Feature → Geometry, Polygon i MultiPolygon (bierze pierwszy).
func ParsePolygonFromGeoJSON(geojsonStr string) (*Polygon, error) {
	var raw map[string]interface{}
	if err := json.Unmarshal([]byte(geojsonStr), &raw); err != nil {
		return nil, err
	}
	return extractPolygon(raw)
}

func extractPolygon(v interface{}) (*Polygon, error) {
	m, ok := v.(map[string]interface{})
	if !ok {
		return nil, nil
	}

	t, _ := m["type"].(string)

	switch t {
	case "Feature":
		if geom, ok := m["geometry"]; ok {
			return extractPolygon(geom)
		}
	case "Polygon":
		return parsePolygonCoords(m["coordinates"])
	case "MultiPolygon":
		// Bierzemy pierwszy polygon z MultiPolygon
		if coords, ok := m["coordinates"].([]interface{}); ok && len(coords) > 0 {
			if first, ok := coords[0].([]interface{}); ok {
				return parsePolygonCoords(first)
			}
		}
	}
	return nil, nil
}

func parsePolygonCoords(rawCoords interface{}) (*Polygon, error) {
	rings, ok := rawCoords.([]interface{})
	if !ok || len(rings) == 0 {
		return nil, nil
	}

	p := &Polygon{}

	for i, ring := range rings {
		coords, ok := ring.([]interface{})
		if !ok {
			continue
		}
		pts := make([]Point, 0, len(coords))
		for _, c := range coords {
			cc, ok := c.([]interface{})
			if !ok || len(cc) < 2 {
				continue
			}
			pts = append(pts, Point{
				Lng: toFloat(cc[0]),
				Lat: toFloat(cc[1]),
			})
		}
		if i == 0 {
			p.Exterior = pts
		} else {
			p.Interiors = append(p.Interiors, pts)
		}
	}

	if len(p.Exterior) < 3 {
		return nil, nil
	}

	return p, nil
}

// Contains sprawdza czy polygon zawiera punkt (ray casting algorithm).
func (p *Polygon) Contains(pt Point) bool {
	if !ringContains(p.Exterior, pt) {
		return false
	}
	for _, interior := range p.Interiors {
		if ringContains(interior, pt) {
			return false
		}
	}
	return true
}

// ringContains — ray casting dla jednego pierścienia
func ringContains(ring []Point, pt Point) bool {
	n := len(ring)
	if n < 3 {
		return false
	}
	inside := false
	j := n - 1
	for i := 0; i < n; i++ {
		if (ring[i].Lat > pt.Lat) != (ring[j].Lat > pt.Lat) {
			xIntersect := ring[i].Lng + (pt.Lat-ring[i].Lat)*(ring[j].Lng-ring[i].Lng)/(ring[j].Lat-ring[i].Lat)
			if pt.Lng < xIntersect {
				inside = !inside
			}
		}
		j = i
	}
	return inside
}

// ============================================================================
// AREA — przybliżona powierzchnia w m² (dla szerokości ~50°N)
// ============================================================================

// AreaM2 oblicza przybliżoną powierzchnię polygonu w metrach kwadratowych.
// Używa szerokości geograficznej ~50° dla konwersji stopni na metry.
func AreaM2(geojsonStr string) float64 {
	p, err := ParsePolygonFromGeoJSON(geojsonStr)
	if err != nil || p == nil {
		return 0
	}

	areaDeg2 := polygonAreaDeg2(p.Exterior)
	for _, interior := range p.Interiors {
		areaDeg2 -= polygonAreaDeg2(interior)
	}
	if areaDeg2 < 0 {
		areaDeg2 = -areaDeg2
	}

	// Konwersja stopni² → m² dla szerokości ~50°N
	latRad := 50.0 * math.Pi / 180.0
	mLat := 111132.92 - 559.82*math.Cos(2*latRad) + 1.175*math.Cos(4*latRad)
	mLng := 111412.84*math.Cos(latRad) - 93.5*math.Cos(3*latRad)
	return areaDeg2 * mLat * mLng
}

func polygonAreaDeg2(ring []Point) float64 {
	n := len(ring)
	if n < 3 {
		return 0
	}
	area := 0.0
	j := n - 1
	for i := 0; i < n; i++ {
		area += (ring[j].Lng + ring[i].Lng) * (ring[j].Lat - ring[i].Lat)
		j = i
	}
	return math.Abs(area) / 2.0
}

// ============================================================================
// LINE LENGTH — przybliżona długość linii w metrach
// ============================================================================

// LineLengthM oblicza długość linii z GeoJSON w metrach.
func LineLengthM(geojsonStr string) float64 {
	if geojsonStr == "" {
		return 0
	}

	var raw map[string]interface{}
	if err := json.Unmarshal([]byte(geojsonStr), &raw); err != nil {
		return 0
	}

	var coords [][]float64

	t, _ := raw["type"].(string)
	switch t {
	case "LineString":
		if c, ok := raw["coordinates"].([]interface{}); ok {
			coords = extractCoordPairs(c)
		}
	case "Polygon":
		if c, ok := raw["coordinates"].([]interface{}); ok && len(c) > 0 {
			if ring, ok := c[0].([]interface{}); ok {
				coords = extractCoordPairs(ring)
			}
		}
	}

	if len(coords) < 2 {
		return 0
	}

	cos50 := math.Cos(50.0 * math.Pi / 180.0)
	totalLen := 0.0
	for i := 1; i < len(coords); i++ {
		dx := (coords[i][0] - coords[i-1][0]) * 111320.0 * cos50
		dy := (coords[i][1] - coords[i-1][1]) * 111320.0
		totalLen += math.Sqrt(dx*dx + dy*dy)
	}
	return totalLen
}

func extractCoordPairs(arr []interface{}) [][]float64 {
	result := make([][]float64, 0, len(arr))
	for _, item := range arr {
		if cc, ok := item.([]interface{}); ok && len(cc) >= 2 {
			result = append(result, []float64{toFloat(cc[0]), toFloat(cc[1])})
		}
	}
	return result
}
