# Wachalarm IP-Web

**`Wachalarm IP-Web`** ist eine Webanwendung, die auf jedem Endgerät - egal ob Windows, Linux, Mac oder Smartphone - Alarminformationen anzeigen kann, ohne das zusätzliche Software installiert werden muss.

Es wird ein moderner Webbrowser (z.B. [Firefox](https://www.firefox.com/de/) oder [Chrome](https://www.google.com/intl/de/chrome/safety/)) zur Darstellung benötigt. Zusätzlich kann mit einem Login und entsprechenden Berechtigungen die Anzeige weiterer Detailinformationen freigeschaltet werden. Die Anwendung ist Open-Source und kann - unter Berücksichtigung der [Lizenz](https://github.com/Robert-112/n112_waip-web/blob/master/LICENSE.md) - von jedem kostenfrei genutzt und weiterentwickelt werden.

![Titelbild Wachalarm IP-Web](https://user-images.githubusercontent.com/19272095/54090568-cbbe6d00-4375-11e9-937e-ae2a6cd9ea7a.jpg)

*Abbildung: Wachalarm IP-Web (Version 1)*

Bereits ohne Anmeldung bietet **`Wachalarm IP-Web`** einen großen [Funktionsumfang](#funktionsumfang), jedoch werden dabei nur grundlegende Einsatzinformationen angezeigt, um den Anforderungen des Datenschutzes gerecht zu werden. Zu diesen Informationen zählen:

- *Einsatzart und Einsatzstichwort*
- *Fahrt mit oder ohne Sondersignal*
- *Ort und Ortsteil des Einsatzes*
- *Karte mit grobem Einsatzort* (Umkreis)
- *alarmierte Einsatzmittel*
    - Einsatzmittel der eigenen Wache
    - weitere alarmierte Einsatzmittel
- *Rückmeldungen der Einsatzkräfte per App*
    - Rolle und Funktion der Einsatzkraft
    - ungefähre Ankunftszeit am Gerätehaus

Mit einer Anmeldung können weitere Einsatzdaten eingesehen werden, sofern die hinterlegte Berechtigung es zulässt. Zu den erweiterten Einsatzinformationen gehören:

- genaue Ortsangaben wie Objekt &amp; Teilobjekt, Straße &amp; Hausnummer, Feuerwehrplan uvm.
- exakte Koordinate des Einsatzortes
- Bemerkungen der Leitstelle zur Ersteinschätzung des Einsatzgrundes
- Namen der Einsatzkräfte, welche per App-Rückmeldung dem Einsatz zugesagt haben
- Einsatznummer des Einsatzes

Mit einem jedem neuen Einsatz wird ein Alarmton inkl. synthetischer Sprachansage abgespielt. Nach einer einstellbaren Zeit gehen Alarmmonitore automatisch in den Standby und zeigen dann nur noch einen Bildschirmschoner (Datum &amp; Uhrzeit) an. Nach einer festgelegten Ablaufzeit (i.d.R. 60 Minuten) werden alle Einsatzdaten aus dem System entfernt und sind nicht mehr abrufbar. Die vollständigen Einsatzdaten finden sich jedoch weiterhin in anderen Systemen wie z.B. dem Einsatzleitsystem der Leitstelle.

---

# Funktionsumfang

Die nachfolgend aufgeführten Funktionen stehen im **`Wachalarm IP-Web`** generelle allen Nutzern zur Verfügung, benötigen zum Freischalten jedoch meist einen Login mittels Benutzernamen und Passwort, bzw. mittels Geräteanmeldung.

---

## Alarmmonitor

[![](https://private-user-images.githubusercontent.com/19272095/494792611-6a1ac4d8-7a95-41aa-b0f0-c7399b6285c6.PNG?jwt=eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJpc3MiOiJnaXRodWIuY29tIiwiYXVkIjoicmF3LmdpdGh1YnVzZXJjb250ZW50LmNvbSIsImtleSI6ImtleTUiLCJleHAiOjE3NTkwMDc1NzIsIm5iZiI6MTc1OTAwNzI3MiwicGF0aCI6Ii8xOTI3MjA5NS80OTQ3OTI2MTEtNmExYWM0ZDgtN2E5NS00MWFhLWIwZjAtYzczOTliNjI4NWM2LlBORz9YLUFtei1BbGdvcml0aG09QVdTNC1ITUFDLVNIQTI1NiZYLUFtei1DcmVkZW50aWFsPUFLSUFWQ09EWUxTQTUzUFFLNFpBJTJGMjAyNTA5MjclMkZ1cy1lYXN0LTElMkZzMyUyRmF3czRfcmVxdWVzdCZYLUFtei1EYXRlPTIwMjUwOTI3VDIxMDc1MlomWC1BbXotRXhwaXJlcz0zMDAmWC1BbXotU2lnbmF0dXJlPTY3NGRmZDM1OWQyMjEyMzczMDk5NTEzM2M1ZjU4OGI2MjMzMWNmMTlhYzg0YjUwOTRjNTViM2UxN2UxMmM4OTImWC1BbXotU2lnbmVkSGVhZGVycz1ob3N0In0.IbtBEzPI5J0U83ox-Ahvtlp3vtvQduouhTRBpQDTETA)](https://private-user-images.githubusercontent.com/19272095/494792611-6a1ac4d8-7a95-41aa-b0f0-c7399b6285c6.PNG?jwt=eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJpc3MiOiJnaXRodWIuY29tIiwiYXVkIjoicmF3LmdpdGh1YnVzZXJjb250ZW50LmNvbSIsImtleSI6ImtleTUiLCJleHAiOjE3NTkwMDc1NzIsIm5iZiI6MTc1OTAwNzI3MiwicGF0aCI6Ii8xOTI3MjA5NS80OTQ3OTI2MTEtNmExYWM0ZDgtN2E5NS00MWFhLWIwZjAtYzczOTliNjI4NWM2LlBORz9YLUFtei1BbGdvcml0aG09QVdTNC1ITUFDLVNIQTI1NiZYLUFtei1DcmVkZW50aWFsPUFLSUFWQ09EWUxTQTUzUFFLNFpBJTJGMjAyNTA5MjclMkZ1cy1lYXN0LTElMkZzMyUyRmF3czRfcmVxdWVzdCZYLUFtei1EYXRlPTIwMjUwOTI3VDIxMDc1MlomWC1BbXotRXhwaXJlcz0zMDAmWC1BbXotU2lnbmF0dXJlPTY3NGRmZDM1OWQyMjEyMzczMDk5NTEzM2M1ZjU4OGI2MjMzMWNmMTlhYzg0YjUwOTRjNTViM2UxN2UxMmM4OTImWC1BbXotU2lnbmVkSGVhZGVycz1ob3N0In0.IbtBEzPI5J0U83ox-Ahvtlp3vtvQduouhTRBpQDTETA)

*Abbildung: Alarmmonitor der Gemeinde Kolkwitz, mit Rückmeldungen, ohne Login*

- Individueller Alarmmonitor für eine oder mehrere Wachen
- Darstellung von Einsatzart, Stichwort, Sondersignal, Ortsdaten (Objekt, Teilobjekt, Ort, Ortsteil, Straße, Hausnummer) inkl. Karte mit Markierung des Einsatzortes
- Anzeige der alarmierten eigenen Einsatzmittel und weiterer beteiligter fremder Einsatzmittel
- Beschreibung des Einsatzes
- Zusatzinformationen wie Einsatznummer, Einsatzzeit, Wachenname, Ablaufzeit, Feuerwehrplan uvm.
- neue Einsätze werden durch einen Gong und eine Sprachansage automatisch in deutscher Sprache angekündigt (Text-To-Speech)
- App-Rückmeldungen (Brandenburg-Alarm) von Einsatzkräften werden passend zur aufgerufenen Wache angezeigt (aber nur wenn positive Rückmeldungen zur Einsatzteilnahme gesendet wurden) und akustisch signalisisert
- wird kein Einsatz dargestellt, wird ein Bildschirmschoner angezeigt (aktuelles Datum und Uhrzeit)
- angemeldete Benutzer können die Anzeigezeit für Alarme einstellen (1 bis 60 Minuten), für alle anderen gilt eine standardmäßig festgelegte Anzeigezeit (z.B. 15 Minuten)
- es können für beliebig viele Wachen entsprechende Alarmmonitore hinterlegt und angezeigt werden, dabei wird in 5 Arten unterschieden (`n` steht für eine Zahl der Wachennummer): 
    1. `/waip/0`
        - öffnet den globalen Alarmmonitor, der alle im System eingehenden Alarme anzeigt
    2. `/waip/n` (`1` bis `5`) 
        - öffnet den Alarmmonitor für einen gesamten Leitstellenbereich
        - die Nummer entspricht der internen Nummierung der Leitstelle
    3. `/waip/nn` (`01` bis `99`) 
        - öffnet den Alarmmonitor eines Landkreises
        - es werden die Alarme aller hinterlegten Wachen des Landkreises anzeigt
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
    - Beispielaufruf: `https://wachalarm.inter.net/waip/661214?rmld=off&sound=off`

---

## Dashboard

[![](https://private-user-images.githubusercontent.com/19272095/494792790-1d0cdee1-ba2e-4623-915e-d75c1c6cc2c5.PNG?jwt=eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJpc3MiOiJnaXRodWIuY29tIiwiYXVkIjoicmF3LmdpdGh1YnVzZXJjb250ZW50LmNvbSIsImtleSI6ImtleTUiLCJleHAiOjE3NTkwMDc1NzIsIm5iZiI6MTc1OTAwNzI3MiwicGF0aCI6Ii8xOTI3MjA5NS80OTQ3OTI3OTAtMWQwY2RlZTEtYmEyZS00NjIzLTkxNWUtZDc1YzFjNmNjMmM1LlBORz9YLUFtei1BbGdvcml0aG09QVdTNC1ITUFDLVNIQTI1NiZYLUFtei1DcmVkZW50aWFsPUFLSUFWQ09EWUxTQTUzUFFLNFpBJTJGMjAyNTA5MjclMkZ1cy1lYXN0LTElMkZzMyUyRmF3czRfcmVxdWVzdCZYLUFtei1EYXRlPTIwMjUwOTI3VDIxMDc1MlomWC1BbXotRXhwaXJlcz0zMDAmWC1BbXotU2lnbmF0dXJlPWFmMDlhOGFlM2NlMTE5ZDM2YTBlMTRlMTg5NGZlNDQ2YmVlM2M1N2M0ZmM1OTA4MmZhZDA3Y2QwZGQyOWQ4YzkmWC1BbXotU2lnbmVkSGVhZGVycz1ob3N0In0.OamUjBdNL-lRSMjAPYrSQHiqpBe1XcAefgnYd-kwUvc)](https://private-user-images.githubusercontent.com/19272095/494792790-1d0cdee1-ba2e-4623-915e-d75c1c6cc2c5.PNG?jwt=eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJpc3MiOiJnaXRodWIuY29tIiwiYXVkIjoicmF3LmdpdGh1YnVzZXJjb250ZW50LmNvbSIsImtleSI6ImtleTUiLCJleHAiOjE3NTkwMDc1NzIsIm5iZiI6MTc1OTAwNzI3MiwicGF0aCI6Ii8xOTI3MjA5NS80OTQ3OTI3OTAtMWQwY2RlZTEtYmEyZS00NjIzLTkxNWUtZDc1YzFjNmNjMmM1LlBORz9YLUFtei1BbGdvcml0aG09QVdTNC1ITUFDLVNIQTI1NiZYLUFtei1DcmVkZW50aWFsPUFLSUFWQ09EWUxTQTUzUFFLNFpBJTJGMjAyNTA5MjclMkZ1cy1lYXN0LTElMkZzMyUyRmF3czRfcmVxdWVzdCZYLUFtei1EYXRlPTIwMjUwOTI3VDIxMDc1MlomWC1BbXotRXhwaXJlcz0zMDAmWC1BbXotU2lnbmF0dXJlPWFmMDlhOGFlM2NlMTE5ZDM2YTBlMTRlMTg5NGZlNDQ2YmVlM2M1N2M0ZmM1OTA4MmZhZDA3Y2QwZGQyOWQ4YzkmWC1BbXotU2lnbmVkSGVhZGVycz1ob3N0In0.OamUjBdNL-lRSMjAPYrSQHiqpBe1XcAefgnYd-kwUvc)

*Abbildung: Dashboard für einen Einsatz der Gemeinde Kolkwitz, öffentliche Darstellung, ohne Login*

- das Dashboard zeigt eine Gesamtübersicht für einen einzigen Einsatz
- es zeigt, ebenso wie der Alarmmonitor, alle einsatzrelevanten Informationen an und berücksichtigt dabei die Berechtigungen des Nutzers (sofern angemeldet)
- im Dashboard werden alle beteiligten Wachen inkl. der alarmierten Einsatzmittel angezeigt
- es werden alle positiven Rückmeldungen zum Einsatz angezeigt, dabei erfolgt eine Zuordnung der Rückmeldungen zu den alarmierten Wachen
- die Rückmeldungen werden je Wache gezählt, inkl. einer Gesamt-Übersicht
- das Dashboard des Einsatzes aktualisiert sich von selbst, ohne das die Seite neu geladen werden muss.

---

## Rückmeldungen

[![](https://private-user-images.githubusercontent.com/19272095/494792788-d9d9b3ac-07dc-4f99-8324-02b5295a97e5.PNG?jwt=eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJpc3MiOiJnaXRodWIuY29tIiwiYXVkIjoicmF3LmdpdGh1YnVzZXJjb250ZW50LmNvbSIsImtleSI6ImtleTUiLCJleHAiOjE3NTkwMDc1NzIsIm5iZiI6MTc1OTAwNzI3MiwicGF0aCI6Ii8xOTI3MjA5NS80OTQ3OTI3ODgtZDlkOWIzYWMtMDdkYy00Zjk5LTgzMjQtMDJiNTI5NWE5N2U1LlBORz9YLUFtei1BbGdvcml0aG09QVdTNC1ITUFDLVNIQTI1NiZYLUFtei1DcmVkZW50aWFsPUFLSUFWQ09EWUxTQTUzUFFLNFpBJTJGMjAyNTA5MjclMkZ1cy1lYXN0LTElMkZzMyUyRmF3czRfcmVxdWVzdCZYLUFtei1EYXRlPTIwMjUwOTI3VDIxMDc1MlomWC1BbXotRXhwaXJlcz0zMDAmWC1BbXotU2lnbmF0dXJlPTc5NDZlZjc5MTZlMWQ3ZDIxNmNlNmJiMTM5N2Q5Zjk5NTViODE3OTQ4ZDJjYWRkY2E4OGY5MzZlY2MyMTBkYmYmWC1BbXotU2lnbmVkSGVhZGVycz1ob3N0In0.Mlpx0VF-5NzSMonFPR9qz43oxmdYTpnE97Y1AKPNsGQ)](https://private-user-images.githubusercontent.com/19272095/494792884-8c14e420-ae97-4426-8fe4-f80466d1eb06.PNG?jwt=eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJpc3MiOiJnaXRodWIuY29tIiwiYXVkIjoicmF3LmdpdGh1YnVzZXJjb250ZW50LmNvbSIsImtleSI6ImtleTUiLCJleHAiOjE3NTkwMDc3MDAsIm5iZiI6MTc1OTAwNzQwMCwicGF0aCI6Ii8xOTI3MjA5NS80OTQ3OTI4ODQtOGMxNGU0MjAtYWU5Ny00NDI2LThmZTQtZjgwNDY2ZDFlYjA2LlBORz9YLUFtei1BbGdvcml0aG09QVdTNC1ITUFDLVNIQTI1NiZYLUFtei1DcmVkZW50aWFsPUFLSUFWQ09EWUxTQTUzUFFLNFpBJTJGMjAyNTA5MjclMkZ1cy1lYXN0LTElMkZzMyUyRmF3czRfcmVxdWVzdCZYLUFtei1EYXRlPTIwMjUwOTI3VDIxMTAwMFomWC1BbXotRXhwaXJlcz0zMDAmWC1BbXotU2lnbmF0dXJlPTcyZWMzOTI4YzNjYzk2MDZjOWM0NzEwY2NhZTNhZDljYmUzMmFlZDg2M2RhZGRmYzViYWQ1YTRiNTQ2MWU0YjAmWC1BbXotU2lnbmVkSGVhZGVycz1ob3N0In0.YF5ImLaXzyRncK5fRgWRgPI9Vx8joCz4Sxpor1ELR-Q)

*Abbildung: öffentliche Darstellung der Rückmeldungen (wenn freigeschaltet)*

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
- Rückmeldungen werden anhand ihrer Rollen aufsummiert, so dass schnell eine Gesamtanzahl ersichtlich ist
- mit Login und entsprechender Berechtigung wird auch der Name der Einsatzkraft in der Rückmeldung angezeigt
- jede Rückmeldung wird standardmäßig mit 10 Minuten von der Meldung bis zur Eintreffzeit bewertet

---

## Administration

- als Benutzer mit der Berechtigung "Administrator" können zentrale Einstellungen des **`Wachalarm IP-Web`** verwaltet werden werden, dazu gehören: 
    - anlegen, bearbeiten und löschen von Benutzern inkl. Kennwortvergabe und Zuweisung der Berechtigungen
    - Bearbeiten der Stammdaten der hinterlegten Wachen sowie das Anlegen von neuen Wachen
    - Einsicht in die derzeit aufgerufenen Alarmmonitore und Dashboards inkl. von Informationen zu den verbundenen [Websockets](https://socket.io)
    - Anzeige der aktuell hinterlegten Einsätze
    - Anzeige einiger Log-Einträge

---

# Screenshots (Version 1.2)
## Startseite

![image](https://user-images.githubusercontent.com/19272095/89553393-bcaf4900-d80d-11ea-845e-18b80ae58865.png)

## Alarmmonitor

### Darstellung im Querformat

> angemeldeter Benutzer mit vollen Rechten auf den Alarmmonitor der Wache 1

![image](https://user-images.githubusercontent.com/19272095/89553449-d355a000-d80d-11ea-9841-46e856eae81f.png)

### Darstellung im Hochformat

>  Benutzer ist nicht angemeldet, sieht reduzierten Inhalt der Wache 2

![image](https://user-images.githubusercontent.com/19272095/89553608-0730c580-d80e-11ea-8aea-5197ef7dcc9b.png)

### Bildschirmschoner

> wird angezeigt wenn kein Einsatz für die Wache vorhanden ist

![image](https://user-images.githubusercontent.com/19272095/89553283-98ec0300-d80d-11ea-9675-8dbf895931b6.png)

## Login

![FireShot Capture 003 - Login - localhost](https://user-images.githubusercontent.com/19272095/54091418-0c22e880-4380-11e9-8657-5011db2435df.png)

## Benutzerverwaltung

![FireShot Capture 004 - Benutzer und Rechte verwalten - localhost](https://user-images.githubusercontent.com/19272095/54091419-0c22e880-4380-11e9-8677-b7f9db1a422d.png)

# Lizenz
#### [\[Creative Commons Attribution Share Alike 4.0 International\]](https://github.com/Robert-112/n112-waip-web/blob/master/LICENSE.md)
