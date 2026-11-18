-- Wetter-Standorte der Leitstellen und Kreise im Land Brandenburg (Vorlage, optional)
--
-- Import in eine bestehende Datenbank:  sqlite3 database.sqlite3 < sql_wetter_orte.sql
-- Vorhandene Einträge mit gleicher Nummer bleiben unverändert, die Datei kann mehrfach eingespielt werden.
-- Die Standorte lassen sich danach unter Verwaltung > Wetter-Standorte (/adm_edit_wetter) anpassen.
--
-- nr: 1-stellig = Leitstelle, 2-stellig = Kreis (wie nr_leitstelle/nr_kreis in waip_wachen)
-- lat/lon: Punkt im Inneren der Fläche mit dem größten Abstand zur Grenze (Polylabel),
--          berechnet aus den Verwaltungsgrenzen der Kreise bzw. Leitstellenbereiche (WGS84)
-- warncell_id: leer, Bright Sky ermittelt die DWD-Warnzelle der Gemeinde aus der Koordinate.
--          Warnungen gelten damit für die Gemeinde am Standort, nicht für den ganzen Kreis.

INSERT OR IGNORE INTO waip_wetter_orte (nr, name, lat, lon, warncell_id) VALUES
('1', 'Leitstelle NordOst', 52.97706, 13.51442, NULL),
('2', 'Leitstelle Nordwest', 52.95818, 12.60304, NULL),
('3', 'Leitstelle Brandenburg', 52.23871, 12.66445, NULL),
('4', 'Leitstelle Lausitz', 51.79642, 14.00011, NULL),
('5', 'Leitstelle Oderland', 52.48192, 14.15446, NULL),
('51', 'Brandenburg an der Havel', 52.40174, 12.51943, NULL),
('52', 'Cottbus', 51.78006, 14.3507, NULL),
('53', 'Frankfurt (Oder)', 52.31594, 14.49454, NULL),
('54', 'Potsdam', 52.42631, 13.01753, NULL),
('60', 'Barnim', 52.87903, 13.72201, NULL),
('61', 'Dahme-Spreewald', 52.0056, 13.83331, NULL),
('62', 'Elbe-Elster', 51.61036, 13.42368, NULL),
('63', 'Havelland', 52.64583, 12.58905, NULL),
('64', 'Märkisch-Oderland', 52.6511, 14.11414, NULL),
('65', 'Oberhavel', 52.78166, 13.20167, NULL),
('66', 'Oberspreewald-Lausitz', 51.47487, 13.89309, NULL),
('67', 'Oder-Spree', 52.26765, 14.12756, NULL),
('68', 'Ostprignitz-Ruppin', 52.97684, 12.71139, NULL),
('69', 'Potsdam-Mittelmark', 52.1846, 12.67937, NULL),
('70', 'Prignitz', 53.09411, 12.00754, NULL),
('71', 'Spree-Neiße', 51.66671, 14.56828, NULL),
('72', 'Teltow-Fläming', 52.11026, 13.29061, NULL),
('73', 'Uckermark', 53.23928, 13.7966, NULL);
