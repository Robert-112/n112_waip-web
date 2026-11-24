# Wachalarm IP-Web

**`Wachalarm IP-Web`** ist eine Webanwendung, die auf jedem Endgerät - egal ob Windows, Linux, Mac oder Smartphone - Alarminformationen anzeigen kann, ohne dass zusätzliche Software installiert werden muss.

Es wird ein moderner Webbrowser (z.B. [Firefox](https://www.firefox.com/de/) oder [Chrome](https://www.google.com/intl/de/chrome/safety/)) zur Darstellung benötigt. Zusätzlich kann mit einem Login und entsprechenden Berechtigungen die Anzeige weiterer Detailinformationen freigeschaltet werden. Die Anwendung ist Open-Source und kann - unter Berücksichtigung der [Lizenz](https://github.com/Robert-112/n112_waip-web/blob/master/LICENSE.md) - von jedem kostenfrei genutzt und weiterentwickelt werden.

![Alarmmonitor mit Login](docs/images/waip_admin.webp)

*Abbildung: Alarmmonitor der Stadt Spremberg, mit Login (Version 2.2, fiktiver Einsatz)*

Bereits ohne Anmeldung bietet **`Wachalarm IP-Web`** einen großen [Funktionsumfang](#funktionsumfang), jedoch werden dabei nur grundlegende Einsatzinformationen angezeigt, um den Anforderungen des Datenschutzes gerecht zu werden. Zu diesen Informationen zählen:

- *Einsatzart und Einsatzstichwort*
- *Fahrt mit oder ohne Sondersignal*
- *Ort und Ortsteil des Einsatzes*
- *Karte mit grobem Einsatzort* (Umkreis)
- *Anfahrtswege der alarmierten Wachen* (sofern ein Routing-Server angebunden ist)
- *alarmierte Einsatzmittel*
    - Einsatzmittel der eigenen Wache
    - weitere alarmierte Einsatzmittel
- *Rückmeldungen der Einsatzkräfte per App*
    - Rolle und Funktion der Einsatzkraft
    - ungefähre Ankunftszeit am Gerätehaus

Mit einer Anmeldung können weitere Einsatzdaten eingesehen werden, sofern die hinterlegte Berechtigung es zulässt. Zu den erweiterten Einsatzinformationen gehören:

- genaue Ortsangaben wie Objekt &amp; Teilobjekt, Straße &amp; Hausnummer, Feuerwehrplan uvm.
- exakte Koordinate des Einsatzortes inkl. Detailkarte
- Bemerkungen der Leitstelle zur Ersteinschätzung des Einsatzgrundes
- Namen der Einsatzkräfte, welche per App-Rückmeldung dem Einsatz zugesagt haben
- Einsatznummer des Einsatzes

Mit jedem neuen Einsatz wird ein Alarmton inkl. synthetischer Sprachansage abgespielt. Nach einer einstellbaren Zeit gehen Alarmmonitore automatisch in den Standby und zeigen dann einen Bildschirmschoner mit Datum &amp; Uhrzeit an, auf Wunsch auch mit Wetter, amtlichen Unwetterwarnungen und Terminen. Nach einer festgelegten Ablaufzeit (je nach Konfiguration z.B. 30 Minuten) werden alle Einsatzdaten aus dem System entfernt und sind nicht mehr abrufbar. Lediglich Brand- und Hilfeleistungseinsätze bleiben mit groben Angaben für einige Tage in einem Kurz-Archiv sichtbar. Die vollständigen Einsatzdaten finden sich jedoch weiterhin in anderen Systemen wie z.B. dem Einsatzleitsystem der Leitstelle.

> Alle Abbildungen in dieser Beschreibung zeigen **fiktive Einsätze**. Namen von Einsatzkräften, Benutzerkonten, IP-Adressen und ähnliche Angaben wurden verfremdet.

---

# Funktionsumfang

Die nachfolgend aufgeführten Funktionen stehen im **`Wachalarm IP-Web`** generell allen Nutzern zur Verfügung, benötigen zum Freischalten jedoch meist einen Login mittels Benutzernamen und Passwort, bzw. mittels Geräteanmeldung.

---

## Alarmmonitor

![Alarmmonitor ohne Login](docs/images/waip_gast.webp)

*Abbildung: Alarmmonitor der Stadt Spremberg, mit Rückmeldungen, ohne Login*

- Individueller Alarmmonitor für eine oder mehrere Wachen
- Darstellung von Einsatzart, Stichwort, Sondersignal, Ortsdaten (Objekt, Teilobjekt, Ort, Ortsteil, Straße, Hausnummer) inkl. Karte mit Markierung des Einsatzortes
    - das Sondersignal steht als runde Plakette neben dem Stichwort: weiß mit Glocke und langsam ausstrahlendem Ring = mit Sondersignal, dunkel mit durchgestrichener Glocke = ohne Sondersignal
- Anzeige der Anfahrtswege von den alarmierten Wachen zum Einsatzort (optional, über einen eigenen [OSRM](https://project-osrm.org/)-Server)
- mit Login zusätzlich eine kleine Detailkarte des Einsatzortes
- Anzeige der alarmierten eigenen Einsatzmittel und weiterer beteiligter fremder Einsatzmittel
- Beschreibung des Einsatzes
- Zusatzinformationen wie Einsatznummer, Einsatzzeit, Wachenname, Ablaufzeit, Feuerwehrplan uvm.
- neue Einsätze werden durch einen Gong und eine Sprachansage automatisch in deutscher Sprache angekündigt (Text-To-Speech, wahlweise mit [Piper](https://github.com/rhasspy/piper))
- App-Rückmeldungen (Brandenburg-Alarm) von Einsatzkräften werden passend zur aufgerufenen Wache angezeigt (aber nur wenn positive Rückmeldungen zur Einsatzteilnahme gesendet wurden) und akustisch signalisiert
- wird kein Einsatz dargestellt, wird ein Bildschirmschoner angezeigt (siehe [Standby-Anzeige](#standby-anzeige))
- angemeldete Benutzer können die Anzeigezeit für Alarme (1 bis 60 Minuten) und die Breite der Karte (20 bis 60 %) einstellen, für alle anderen gilt eine standardmäßig festgelegte Anzeigezeit (z.B. 15 Minuten)
- die Darstellung passt sich automatisch an das Endgerät an (Fernseher im Querformat, Tablet, Smartphone im Hochformat) und läuft auch auf leistungsschwacher Hardware wie einem Raspberry Pi
- es können für beliebig viele Wachen entsprechende Alarmmonitore hinterlegt und angezeigt werden, dabei wird in 5 Arten unterschieden (`n` steht für eine Zahl der Wachennummer):
    1. `/waip/0`
        - öffnet den globalen Alarmmonitor, der alle im System eingehenden Alarme anzeigt
    2. `/waip/n` (`1` bis `5`)
        - öffnet den Alarmmonitor für einen gesamten Leitstellenbereich
        - die Nummer entspricht der internen Nummerierung der Leitstelle
    3. `/waip/nn` (`01` bis `99`)
        - öffnet den Alarmmonitor eines Landkreises
        - es werden die Alarme aller hinterlegten Wachen des Landkreises angezeigt
        - die Nummer entspricht der Kennung des Landkreises entsprechend des amtlichen Gemeindeschlüssels
    4. `/waip/nnnn` (`0001` bis `9999`)
        - öffnet den Alarmmonitor eines Aufgabenträgers
        - z.B. einer amtsfreien Gemeinde, einer Stadt, eines Amtes, oder auch des Rettungsdienstes eines Landkreises
        - die Nummer entspricht dabei den ersten 4 Zahlen der Wachennummer
    5. `/waip/nnnnnn` (`000001` bis `999999`)
        - öffnet den Alarmmonitor einer einzigen Wache
        - es werden nur Einsätze dieser Wache angezeigt
        - die Nummer entspricht der Wachennummer
- Außerdem können beim Aufruf eines Alarmmonitors weitere optionale Parameter übergeben werden, um das Anzeigeverhalten zu steuern
    - `rmld=off`
        - blendet App-Rückmeldungen im Alarmmonitor aus
        - z.B. bei Rettungswachen, die keine Rückmeldungen verwenden
    - `sound=off`
        - deaktiviert Hinweise zur Audioausgabe
        - z.B. wenn kein Lautsprecher angeschlossen ist
    - `anim=off`
        - reduziert Animationen
        - z.B. für leistungsschwache Geräte wie einen Raspberry Pi 3
    - `wetter=on` bzw. `wetter=off`
        - blendet Wetter und Unwetterwarnungen im Standby ein bzw. aus, auch ohne Anmeldung (überstimmt die Einstellung des Benutzers bzw. `WIDGET_WETTER_STANDARD`)
    - Beispielaufruf: `https://wachalarm.inter.net/waip/661214?rmld=off&sound=off`
- die Parameter lassen sich auch bequem auf der Auswahlseite des Alarmmonitors per Schalter setzen

---

## Standby-Anzeige

![Standby-Anzeige mit Wetter, Terminen und Ticker](docs/images/waip_standby.webp)

*Abbildung: Standby-Anzeige mit Wetter, Unwetterwarnung, Waldbrandgefahr, Terminen und Ticker (fiktive Meldungen)*

- ist kein Einsatz aktiv, zeigt der Alarmmonitor Uhrzeit und Datum an
- auf Wunsch werden zusätzlich angezeigt:
    - das aktuelle Wetter mit Höchst- und Tiefstwert sowie die Vorhersage für die nächsten zwei Tage (die Wetteranzeige wird so groß, wie es der Platz erlaubt)
    - amtliche Unwetterwarnungen des Deutschen Wetterdienstes
    - die Waldbrandgefahrenstufe (ab einer einstellbaren Stufe)
    - die nächsten Termine aus einem Kalender (iCal/ICS), z.B. Dienstabende
    - ein Ticker mit aktuellen Meldungen am unteren Rand, wichtige Meldungen in einer eigenen roten Zeile (nur angemeldete Monitore, nie im Einsatz)
- alle Daten holt ausschließlich der Server, die Alarmmonitore selbst benötigen keinen Zugriff auf das Internet
- die Wetterdaten stammen vom Deutschen Wetterdienst und werden über einen selbst betriebenen [Bright Sky](https://brightsky.dev/)-Dienst abgerufen
- Termine und Ticker-Meldungen holt ein eigener Kalender-Dienst (Docker) aus SOGo, Nextcloud o.ä. (`WIDGET_KALENDER_URL`); die Meldungen werden im Kalender gepflegt: jeder laufende Termin ist eine Meldung, die Priorität „hoch“, `!!` vor dem Titel oder Schlagwörter wie „dringend“ machen sie rot, Priorität „normal“, `!` oder „wichtig“ gelb
- der Ticker eines Monitors zeigt die Meldungen seiner Leitstelle und seines Kreises (Administration › Ticker-Quellen) sowie den eigenen Ticker-Kalender des Benutzers
- angemeldete Benutzer haben das Wetter standardmäßig eingeschaltet (unter `Einstellungen` abschaltbar), schalten dort den Kalender ein und tragen ihren Ticker-Kalender ein; für Monitore ohne Anmeldung gilt `WIDGET_WETTER_STANDARD`, einzelne Monitore lassen sich mit `wetter=on/off` umschalten
- erlaubt sind nur öffentliche Kalender (ohne Login) von Servern, die der Betreiber freigegeben hat (`KALENDER_DOMAINS` im Kalender-Dienst); die Einstellungen zeigen diese Server und unter jeder gespeicherten Adresse, ob die Verbindung funktioniert
- der gesamte Inhalt wandert regelmäßig ein Stück über den Bildschirm, der Ticker läuft ständig und wechselt leicht die Höhe, damit sich nichts in das Display einbrennt

---

## Dashboard

![Dashboard eines Einsatzes](docs/images/dbrd_admin.webp)

*Abbildung: Dashboard für einen Einsatz der Stadt Spremberg, mit Login*

- das Dashboard zeigt eine Gesamtübersicht für einen einzigen Einsatz
- es zeigt, ebenso wie der Alarmmonitor, alle einsatzrelevanten Informationen an und berücksichtigt dabei die Berechtigungen des Nutzers (sofern angemeldet)
- im Dashboard werden alle beteiligten Wachen inkl. der alarmierten Einsatzmittel und deren Anfahrtswege angezeigt
- es werden alle positiven Rückmeldungen zum Einsatz angezeigt, dabei erfolgt eine Zuordnung der Rückmeldungen zu den alarmierten Wachen
- die Rückmeldungen werden je Wache gezählt, inkl. einer Gesamt-Übersicht (erscheint erst, wenn Rückmeldungen eingehen)
- das Dashboard des Einsatzes aktualisiert sich von selbst, ohne dass die Seite neu geladen werden muss

![Übersicht der laufenden Einsätze](docs/images/dbrd_uebersicht.webp)

*Abbildung: Übersicht der laufenden Einsätze mit Kurz-Archiv*

- die Übersicht zeigt alle laufenden Einsätze als Kacheln mit kleiner Karte sowie der Anzahl der alarmierten Einsatzmittel und der bisherigen Rückmeldungen
- Rettungseinsätze und Krankentransporte sind standardmäßig ausgeblendet und lassen sich per Schalter einblenden
- beendete Brand- und Hilfeleistungseinsätze bleiben für einige Tage (Standard: 3 Tage) im Kurz-Archiv sichtbar
    - dort stehen nur grobe Angaben: Zeit, Ort und Ortsteil, Einsatzart und Stichwort, alarmierte Einsatzmittel sowie die Anzahl der Rückmeldungen
    - keine Karte, keine Straße, keine Einsatznummer und keine Namen
    - das Archiv kann nach Ort, Stichwort, Einsatzmittel oder Datum durchsucht und nach Einsatzart gefiltert werden
    - ein Datum kann z.B. als `13.11.`, als Wochentag (`Freitag`) oder als `heute`, `gestern` bzw. `vorgestern` eingegeben werden, mehrere Suchbegriffe werden kombiniert (z.B. `gestern BMA`)
    - es werden 10 Einsätze je Seite angezeigt, darunter kann geblättert werden, Suche und Filter wirken dabei immer auf alle Einträge
- wird ein alter Link auf ein Dashboard aufgerufen, dessen Einsatz bereits beendet ist, erfolgt eine Weiterleitung zum passenden Eintrag im Archiv

---

## Rückmeldungen

![Rückmeldungen auf dem Smartphone](docs/images/dbrd_mobil.webp)

*Abbildung: öffentliche Darstellung der Rückmeldungen auf dem Smartphone (wenn freigeschaltet)*

- die Darstellung der Rückmeldungen bietet Einsatz- und Führungskräften eine einfache Möglichkeit, um einzuschätzen wie viele Personen am Einsatz teilnehmen werden und über welche Fähigkeiten diese verfügen
- **`Wachalarm IP-Web`** verarbeitet automatisch alle App-Rückmeldungen, die über die Schnittstelle (Rest-Api) eingehen
- die Anzeige erfolgt im Alarmmonitor und im Dashboard
- die Rückmeldungen werden den alarmierten Wachen zugeordnet und sofort nach Eingang angezeigt
- Bedeutung der verwendeten Abkürzungen:
    - Rollen:
        - `EK` - Einsatzkraft
        - `GF` - Gruppenführer
        - `ZF` - Zugführer
        - `VF` - Verbandsführer
    - Funktionen:
        - `AGT` - Atemschutzgeräteträger
        - `MA` - Maschinist
        - `FZF` - Fahrzeugführer
        - `MED` - medizinische Kenntnisse
- Rückmeldungen werden anhand ihrer Rollen und Funktionen aufsummiert, so dass schnell eine Gesamtanzahl ersichtlich ist
- jeder Balken zeigt die verbleibende Zeit bis zur ungefähren Ankunft am Gerätehaus, ist diese erreicht erscheint ein Haken
- Rückmeldungen mit Atemschutz (`AGT`) sind farblich umrandet
- mit Login und entsprechender Berechtigung wird auch der Name der Einsatzkraft in der Rückmeldung angezeigt, ohne Login erscheint stattdessen die Rolle

---

## Smartphone und Tablet

![Alarmmonitor auf dem Smartphone](docs/images/waip_mobil.webp)

*Abbildung: Alarmmonitor der Gemeinde Kolkwitz auf dem Smartphone, mit Login*

- Alarmmonitor und Dashboard sind auch auf Smartphones und Tablets nutzbar, im Hoch- und im Querformat
- auf kleinen Bildschirmen werden Karte, Rückmeldungen und Einsatzmittel untereinander angeordnet
- zu lange Namen in den Rückmeldungen laufen als Ticker durch den Balken

---

## Administration

![Verbundene Clients](docs/images/adm_clients.webp)

*Abbildung: Übersicht der verbundenen Alarmmonitore und Dashboards*

- als Benutzer mit der Berechtigung "Administrator" können zentrale Einstellungen des **`Wachalarm IP-Web`** verwaltet werden, dazu gehören:
    - anlegen, bearbeiten und löschen von Benutzern inkl. Kennwortvergabe und Zuweisung der Berechtigungen
    - Einsicht und Änderung der persönlichen Einstellungen eines Benutzers (Anzeigezeit, Kartenbreite, Standby mit Kalender und Ticker), inkl. Verbindungsstatus der Kalender
    - Bearbeiten der Stammdaten der hinterlegten Wachen sowie das Anlegen von neuen Wachen
    - Einsicht in die derzeit aufgerufenen Alarmmonitore und Dashboards inkl. von Informationen zu den verbundenen [Websockets](https://socket.io)
    - Prüfung, ob ein Alarmmonitor unzulässig mit dem Internet verbunden ist (Netzkopplung)
    - Anzeige der aktuell hinterlegten Einsätze
    - Anzeige einiger Log-Einträge
    - Pflege der Wetter-Standorte für die Standby-Anzeige
    - Pflege der Ticker-Quellen (Kalender der Leitstellen und Kreise)
    - Pflege von Ersetzungen für die Sprachansage, inkl. Probehören der Aussprache
- Benutzer mit der lokalen Rolle "Datenpfleger" dürfen die Stammdaten pflegen (Wachen, Wetter-Standorte, Ticker-Quellen, Ersetzungen und Aussprache), sehen aber keine Benutzerverwaltung, Einsätze, verbundenen Clients und Logs
- optional melden sich Benutzer über eine zentrale Benutzerverwaltung (Keycloak bzw. OpenID Connect) an, auch mehrere Server oder Realms sind möglich (`OIDC_PROVIDER` in der `.env`):
    - eine Client-Rolle regelt, wer sich anmelden darf, die Wachen-Rechte kommen aus einem Gruppen-Attribut
    - das Konto wird bei der ersten Anmeldung angelegt, bestehende Konten werden über die Keycloak-ID verknüpft
    - lokale Rollen (Administrator, Datenpfleger) und zusätzliche Wachen-Rechte werden nur im **`Wachalarm IP-Web`** vergeben

![Ersetzungen und Aussprache](docs/images/adm_ersetzungen.webp)

*Abbildung: Ersetzungen für die Sprachansage mit Probehören*

- für die Überwachung steht unter `/check_mk` ein Local Check für [Checkmk](https://checkmk.com/) bereit (nur von `localhost` erreichbar)
- sicherheits- und stabilitätsrelevante Ereignisse können zusätzlich als JSON-Log (ECS) z.B. an Elasticsearch übergeben werden, siehe [elastic/README.md](elastic/README.md)

---

# Installation

- benötigt wird [Node.js](https://nodejs.org/) ab Version 24.5
- Repository herunterladen und Abhängigkeiten installieren:
    - `git clone https://github.com/Robert-112/n112_waip-web.git`
    - `cd n112_waip-web`
    - `npm install`
- Datei `.env.example` nach `.env` kopieren und anpassen, mindestens:
    - `DEFAULT_PASS` und `DEFAULT_API_PASS` (Kennwörter für den ersten Start)
    - `SESSION_SECRET` und `JWT_SECRET` (lange, zufällige Zeichenketten)
    - `PUBLIC_URL`, `APP_NAME` und `COMPANY`
- Anwendung starten mit `npm start` (für den Dauerbetrieb z.B. mit [pm2](https://pm2.keymetrics.io/): `pm2 start ecosystem.config.js`; die Dateiüberwachung ist dabei aus, für die Entwicklung `PM2_WATCH=true pm2 start ecosystem.config.js`)
- die Anwendung ist anschließend unter `http://<server>:3001` erreichbar, die Datenbank wird beim ersten Start angelegt
- die Wachen werden per SQL importiert, die Datei `sql_seed.sql` enthält alle bekannten Wachen des Landes Brandenburg und einige Ersetzungen für die Sprachansage (z.B. `sqlite3 database.sqlite3 < sql_seed.sql`)
- optionale Dienste, die jeweils in der `.env` eingetragen werden:
    - [OSRM](https://project-osrm.org/) für die Anfahrtswege
    - [Piper](https://github.com/rhasspy/piper) (Wyoming-Protokoll) für eine natürlichere Sprachansage
    - [Bright Sky](https://brightsky.dev/) für Wetter und Unwetterwarnungen (fertige Wetter-Standorte für die fünf Leitstellen und alle Kreise in Brandenburg: `sqlite3 database.sqlite3 < sql_wetter_orte.sql`)
    - ein eigener Kalender-Dienst (Docker) für Termine und Ticker im Standby
    - Filebeat und Elasticsearch für die Auswertung der Logs
    - [Keycloak](https://www.keycloak.org/) (oder ein anderer OpenID-Connect-Server) für die Anmeldung mit zentralen Benutzerkonten

> ⚠ **Achtung:** Ohne Anpassung der `.env` gelten unsichere Standard-Kennwörter. Diese unbedingt vor dem ersten Start ändern!

---

# Weitere Ansichten

## Startseite

![Startseite](docs/images/startseite.webp)

## Auswahl des Alarmmonitors

![Auswahl des Alarmmonitors](docs/images/waip_auswahl.webp)

## Login

![Login](docs/images/login.webp)

## Einstellungen

![Einstellungen](docs/images/einstellungen.webp)

## Benutzerverwaltung

![Benutzerverwaltung](docs/images/adm_benutzer.webp)

---

# Versionsverlauf

## 2.2.3 (November 2026)

- Einstellungen: Hinweis, dass nur öffentliche Kalender von freigegebenen Servern möglich sind und weitere Server auf Anfrage vom Betreiber freigegeben werden können
- Einstellungen: unter jeder gespeicherten Kalender-Adresse (Termine und eigener Ticker) wird angezeigt, ob die Verbindung funktioniert
- Benutzerverwaltung: neuer Button `Einstellungen`, mit dem Administratoren die persönlichen Einstellungen eines Benutzers einsehen und ändern können (Anzeigezeit, Kartenbreite, Wetter, Kalender, Ticker)
- Wetter im Standby ist für jedes Benutzerkonto eingeschaltet (auch neue Konten mit Zertifikat oder Keycloak), bis der Benutzer es ausschaltet
- `WIDGET_WETTER_STANDARD` gilt nur noch für Monitore ohne Anmeldung und überstimmt nicht mehr die Einstellung angemeldeter Benutzer
- Keycloak: neuer Schalter `OIDC_<ID>_PROXY`, der Server erreicht Keycloak dann über einen HTTP-Proxy (nur diese Verbindungen, alle anderen bleiben direkt); beim Update `npm install` ausführen (neues Paket `undici`)
- Anzeigezeit: Auswahl nur noch bis zur Löschzeit der Einsätze (`TIME_TO_DELETE_WAIP`), größere Werte wurden bisher stillschweigend auf den Standard zurückgesetzt; `Standard` folgt jetzt wieder `DEFAULT_TIME_FOR_STANDBY`

## 2.2.2 (November 2026)

- Dashboard: Zähler der Rückmeldungen erscheinen erst, wenn Rückmeldungen eingehen
- Dashboard-Übersicht: Kacheln zeigen die Anzahl der alarmierten Einsatzmittel und der Rückmeldungen
- Dashboard-Karte zeigt den Einsatzkreis bzw. Einsatzort auch dann vollständig, wenn eine Wache im Einsatzkreis liegt
- Standby-Wetter: Höchst- und Tiefstwert untereinander, Datum statt „Übermorgen“, Wetteranzeige wird so groß, wie es der Platz erlaubt
- **Sondersignal** im Alarmmonitor und Dashboard als gut sichtbare Plakette (mit Sondersignal hell mit dezent ausstrahlendem Ring, ohne dunkel), bei jeder Einsatzart mit hohem Kontrast

## 2.2.1 (November 2026)

- **Standby-Ticker**: Laufschrift mit Meldungen der Leitstelle, des Landkreises und einem eigenen Ticker des Benutzers, wichtige Meldungen in einer eigenen roten Zeile (nur Standby, nur angemeldete Monitore)
- **Kalender-Dienst** (eigener Docker): holt Termine und Ticker-Meldungen aus SOGo, Nextcloud o.ä., der Alarmserver selbst lädt keine Kalender mehr
- neue Seite `Ticker-Quellen` für die Kalender der Leitstellen und Kreise
- neue lokale Rolle **Datenpfleger**: pflegt Wachen, Wetter-Standorte, Ticker-Quellen sowie Ersetzungen und Aussprache, ohne Zugriff auf Benutzer, Einsätze, Clients und Logs
- Stammdaten-Seiten (Wachen, Wetter-Standorte) ruhiger gestaltet: Tabelle zum Lesen, Bearbeiten im Dialog, Koordinaten per Karte setzen
- **Anmeldung über Keycloak** (OpenID Connect): Client-Rolle regelt den Zugang, Wachen-Rechte aus einem Gruppen-Attribut, lokale Rollen und Zusatzrechte bleiben im Wachalarm, mehrere Server bzw. Realms möglich

> Hinweis zum Update: `npm install` ausführen (neues Paket für Keycloak).

## 2.2.0 (November 2026)

- **neues Design** auf Basis von Bootstrap 5: neue Startseite, Login mit allen Anmeldewegen, ruhigere Seiten, Bootstrap Icons, Alarmmonitore auf der Startseite kompakt je Berechtigung
- **Standby-Widgets**: Wetter und Vorhersage, amtliche Unwetterwarnungen (DWD über Bright Sky), Waldbrandgefahrenstufe und Termine aus einem Kalender, Parameter `wetter=on/off`
- **Dashboard-Übersicht** aller laufenden Einsätze als Kacheln, Rettungsdienst standardmäßig ausgeblendet
- Alarmmonitor deutlich flüssiger auf schwacher Hardware (z.B. Raspberry Pi), Parameter `anim=off`
- Rückmeldungen übersichtlicher: Restzeit, Name und Funktionen im Balken, zu lange Texte als Ticker
- Alarmmonitore werden nicht mehr alle ~90 Sekunden getrennt (Sitzungsablauf behoben)
- **Kurz-Archiv** beendeter Brand- und Hilfeleistungseinsätze (3 Tage, grobe Angaben), mit Seiten, Suche und Datumssuche, alte Dashboard-Links führen ins Archiv
- **Ersetzungen und Aussprache**: alle Ersetzungen auf einer Seite, Sprachansage direkt probehören
- Karte: zuverlässiges Einpassen, neuer Zielmarker, Routen nur auf gemeinsamen Straßen versetzt, Darstellung auf 4K wie in Full-HD
- Kartenbreite im Alarmmonitor pro Benutzer einstellbar, Ablauf-Timer passt sich der Balkenhöhe an
- Einsatzmittel ohne Alarmierungszeit lösen keinen Alarm mehr aus (nur noch Information)
- kein Cookie-Hinweis mehr auf Alarmmonitor und Dashboard (nur technisch notwendige Cookies)
- Fehlerbehebungen in der Schnittstelle (`/api/get_token`, `/api/einsatzstatus`)
- Absturzsicherheit verbessert, pm2 im Betrieb ohne Dateiüberwachung
- neue README mit aktuellen Abbildungen

> Hinweise zum Update: Node.js ab Version 24.5 erforderlich. Für die geänderte pm2-Konfiguration einmalig `pm2 delete n112_waip-web` und `pm2 start ecosystem.config.js`.

## 2.1.3 (November 2026)

- Sicherheitsupdates, u.a. Schutz der Formulare gegen fremde Anfragen (CSRF) und sichere Ausgabe von Client-Daten in der Administration
- Prüfung auf Netzkopplung verbessert (Status `Teilweise`, Prüfung auch nach Wiederverbindung)
- strukturiertes Protokoll (JSON/ECS) für Elasticsearch, siehe [elastic/README.md](elastic/README.md)

## 2.1.2 (Juli/August 2026)

- Prüfung, ob ein Alarmmonitor unzulässig mit dem Internet verbunden ist (Netzkopplung)
- Routen mehrerer Wachen nebeneinander, Wache auf der Karte auch bei reduzierter Darstellung
- erste Administration von Ersetzungen für die Sprachansage
- Fehlerbehebung bei Nachalarmierungen (2.1.2b), Symbol in der Fußzeile, wenn nicht angemeldet

## 2.1.0 und 2.1.1 (Juni/Juli 2026)

- Einstellungen in der Datei `.env` statt `app_cfg.js`, Wachen-Vorlage als `sql_seed.sql`
- Sprachansage mit [Piper](https://github.com/rhasspy/piper)
- Anfahrtswege der Wachen auf der Karte ([OSRM](https://project-osrm.org/))
- Einsätze werden nur gespeichert, wenn eine aktive Wache beteiligt ist
- vollständige Einsatzdaten werden nicht mehr durch reduzierte überschrieben

## 2.0.x (Juni 2025 bis Juni 2026)

- 2.0: Neuauflage mit Rest-Api und Token-Absicherung (JWT), neue Datenbankanbindung
- 2.0.3: Anmeldung per Client-Zertifikat (Geräteanmeldung, z.B. BOS-Pad)
- 2.0.4 bis 2.0.6: Verbesserungen bei Ton, Karte (HD/4K), Ablaufzeit und Dashboard, Parameter `sound=off`, Wachenname im Titel
- 2.0.7: verknüpfte (virtuelle) Wachen, Ersetzungen in der Sprachansage, Anzeige der aktuellen Einsätze und Wachen für Benutzer
- 2.0.9 und 2.0.10: Aktiv-Schalter für Wachen, Beschreibung bei Benutzern, Überwachung per Check_MK, Sekunden in der Standby-Uhr, Leistungsverbesserungen

---

# Geplant

- mehrere Wachen bzw. Aufgabenträger auf einem Alarmmonitor (`/waip/<nr1>,<nr2>`), mit Wechsel zwischen den Einsätzen
- Wechsel zwischen mehreren gleichzeitigen Einsätzen einer Wache

# Lizenz
#### [\[Creative Commons Attribution Share Alike 4.0 International\]](https://github.com/Robert-112/n112_waip-web/blob/master/LICENSE.md)
