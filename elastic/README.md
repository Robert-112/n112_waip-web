# Wachalarm-Logs in Elasticsearch

Der Wachalarm schreibt sicherheits- und stabilitätsrelevante Ereignisse als JSON-Zeilen im
[Elastic Common Schema (ECS)](https://www.elastic.co/guide/en/ecs/current/index.html) in eine Datei.
Filebeat liest diese Datei und sendet die Ereignisse an den Data Stream `logs-wachalarm-default`.

```
Wachalarm (Node) ──► /var/log/wachalarm/wachalarm.ndjson ──► Filebeat ──TLS/API-Key──► Elasticsearch ──► Kibana
```

Ist Elasticsearch nicht erreichbar, holt Filebeat die Übertragung später nach. Der Wachalarm
selbst ist davon nicht betroffen.

## Was protokolliert wird

| `event.action` | Bedeutung | Level |
|---|---|---|
| `login` | Anmeldung per Passwort oder Client-Zertifikat, `event.outcome` success/failure, `event.reason` z.B. `passwort-falsch`, `benutzer-unbekannt`, `zertifikat-unbekannt` | info / warn |
| `logout` | Abmeldung | info |
| `api-token` | API-Token ausgestellt oder verweigert (keine API-Berechtigung) | info / warn |
| `csrf-abgelehnt` | Formular mit ungültigem CSRF-Token | warn |
| `zugriff-verweigert` | HTTP 401/403 (z.B. Admin-Seite ohne Rechte, API ohne gültiges Token) | warn |
| `http-fehler` / `http-serverfehler` | sonstige HTTP-4xx (z.B. 404 durch Scanner) bzw. 5xx | info / error |
| `user-angelegt` / `user-geaendert` / `user-geloescht` | Benutzerverwaltung, `user.name` = ausführender Admin | info |
| `wache-*` / `ersetzung-*` | Änderungen an Wachen und Ersetzungen | info |
| `netzkopplung-pruefung` | Ergebnis jeder Netzkopplungsprüfung eines Alarmmonitors; bei Verdacht `event.kind: alert` | info / warn |
| `monitor-verbunden` / `monitor-getrennt` | Alarmmonitor verbunden (Wache, IP, User-Agent, Benutzer) bzw. getrennt (Grund, Verbindungsdauer) | info / warn |
| `dashboard-verbunden` / `dashboard-getrennt` | dasselbe für Dashboards | info / warn |
| `socket-verbindungsfehler` | abgelehnter Socket.IO-Verbindungsaufbau | warn |
| `session-erneuerung` | Session eines Monitors konnte nicht erneuert werden, Verbindung wird zurückgesetzt | warn |
| `einsatz-empfangen` / `einsatz-verworfen` | Einsatz über die API empfangen (nur ID und Anzahl Wachen/Einsatzmittel) | info / error |
| `einsatz-gesendet` / `einsatz-doppelalarm` | Einsatz an einen Monitor gesendet; `wachalarm.vollzugriff` zeigt, ob vollständige Daten übertragen wurden | info |
| `rueckmeldung-empfangen` | Rückmeldungen über die API (nur Anzahl) | info / error |
| `tts-erzeugt` | Sprachansage erzeugt (Dauer in `event.duration`) oder fehlgeschlagen | info / warn |
| `anwendung-gestartet` / `anwendung-gestoppt` / `anwendung-absturz` | Prozess-Lebenszyklus, Absturz mit Stacktrace | info / critical |
| `unsichere-konfiguration` | `SESSION_SECRET`/`JWT_SECRET` nicht gesetzt (Standardwert aktiv) | warn |
| `kennzahlen` | alle 60 s: verbundene Monitore/Dashboards, Speicher, Event-Loop-Verzögerung (`wachalarm.metriken.*`) | info |
| `anwendungsmeldung` | alle übrigen Warnungen und Fehler der Anwendung als Freitext | warn / error |

**Datenschutz:** Einsatzinhalte (Adressen, Stichworte, Besonderheiten, Namen aus Rückmeldungen)
gelangen nicht in diese Datei, nur IDs, Wachennummern und Zähler. Einfache Meldungen der Typen
`log`/`info`/`debug` bleiben auf der Konsole. Bei unbekannten Benutzernamen wird der Name nicht
gespeichert, weil dort versehentlich ein Passwort stehen kann. Personenbezogen sind
weiterhin IP-Adressen und Benutzernamen, deshalb gilt in Elasticsearch eine Löschfrist (ILM, 90 Tage).

## Einrichtung

### 1. Wachalarm

In der `.env`:

```ini
LOG_JSON_FILE=/var/log/wachalarm/wachalarm.ndjson
LOG_METRICS_INTERVAL=60
```

Verzeichnis anlegen (Benutzer `wachalarm` = Benutzer, unter dem pm2 läuft):

```bash
sudo mkdir -p /var/log/wachalarm
sudo chown wachalarm:wachalarm /var/log/wachalarm
sudo chmod 750 /var/log/wachalarm
```

Danach den Wachalarm neu starten (`pm2 restart n112_waip-web`) und prüfen:
`tail -f /var/log/wachalarm/wachalarm.ndjson`

Log-Rotation: `logrotate-wachalarm` nach `/etc/logrotate.d/wachalarm` kopieren, Benutzer anpassen,
mit `sudo logrotate -d /etc/logrotate.d/wachalarm` testen.

### 2. Elasticsearch

Die Anfragen aus `es-setup.txt` der Reihe nach in Kibana → Dev Tools ausführen
(ILM-Richtlinie, Mapping, Index-Template, API-Key). Aus der Antwort des letzten Schritts
`id` und `api_key` notieren.

### 3. Filebeat auf dem Wachalarm-Server (Ubuntu)

```bash
# Elastic-Paketquelle
wget -qO - https://artifacts.elastic.co/GPG-KEY-elasticsearch | sudo gpg --dearmor -o /usr/share/keyrings/elasticsearch-keyring.gpg
echo "deb [signed-by=/usr/share/keyrings/elasticsearch-keyring.gpg] https://artifacts.elastic.co/packages/8.x/apt stable main" \
  | sudo tee /etc/apt/sources.list.d/elastic-8.x.list
sudo apt-get update
# gleiche Version wie Elasticsearch, Filebeat darf nicht neuer als ES sein
sudo apt-get install filebeat=8.19.10
sudo apt-mark hold filebeat

# Konfiguration
sudo cp filebeat.yml /etc/filebeat/filebeat.yml   # ES-SERVER eintragen
sudo mkdir -p /etc/filebeat/certs
sudo cp http_ca.crt /etc/filebeat/certs/          # CA vom ES-Server (/etc/elasticsearch/certs/http_ca.crt)

# API-Key im Keystore ablegen (Eingabe: <id>:<api_key>)
sudo filebeat keystore create
sudo filebeat keystore add WACHALARM_ES_API_KEY

# Prüfen und starten
sudo filebeat test config
sudo filebeat test output
sudo systemctl enable --now filebeat
```

Statt der CA-Datei kann in `filebeat.yml` auch `ssl.ca_trusted_fingerprint` gesetzt werden.
Den Fingerabdruck zeigt Elasticsearch beim ersten Start an.

### 4. Firewall

Filebeat baut die Verbindung vom Wachalarm-Server aus auf. Am Wachalarm-Server ist also nichts
eingehend zu öffnen.

```bash
# auf dem Elasticsearch-Server: Port 9200 nur für den Wachalarm-Server (und Kibana) freigeben
sudo ufw allow from <WACHALARM-IP> to any port 9200 proto tcp comment 'Filebeat Wachalarm'

# auf dem Wachalarm-Server, nur falls ausgehender Verkehr per ufw eingeschränkt ist
sudo ufw allow out to <ES-IP> port 9200 proto tcp comment 'Filebeat -> Elasticsearch'
```

### 5. Kibana

Data View `logs-wachalarm-*` mit Zeitfeld `@timestamp` anlegen. Nützliche Abfragen (KQL):

| Frage | KQL |
|---|---|
| Fehlgeschlagene Anmeldungen | `event.action:login and event.outcome:failure` |
| Brute-Force-Verdacht | wie oben, in Lens nach `client.ip` gruppiert |
| Netzkopplungs-Verdacht | `event.action:"netzkopplung-pruefung" and wachalarm.netzkopplung.status > 0` |
| Abgelehnte Zugriffe | `event.action:("zugriff-verweigert" or "csrf-abgelehnt")` |
| Änderungen durch Admins | `event.category:(iam or configuration)` |
| Monitor-Verbindungsabbrüche (Netz) | `event.action:"monitor-getrennt" and event.reason:("ping timeout" or "transport close" or "transport error")` |
| Wer hat vollständige Einsatzdaten erhalten | `event.action:"einsatz-gesendet" and wachalarm.vollzugriff:true` |
| Abstürze und Neustarts | `event.action:("anwendung-absturz" or "anwendung-gestartet")` |
| Sprachausgabe langsam/fehlerhaft | `event.action:"tts-erzeugt"` (Lens: Mittelwert `event.duration`) |
| Auslastung | `event.action:kennzahlen` (Lens: `wachalarm.metriken.*` über die Zeit) |

Vorschläge für Regeln (Stack Management → Rules, Typ „Elasticsearch query“):

- Mehr als 10 fehlgeschlagene Anmeldungen einer IP in 5 Minuten
- Jedes Ereignis mit `event.kind:alert` (Netzkopplung, unsichere Konfiguration)
- `event.action:"anwendung-absturz"`
- **Kein** `kennzahlen`-Ereignis seit 5 Minuten: Wachalarm oder Filebeat ausgefallen

Welche Benachrichtigungswege (E-Mail, Webhook) zur Verfügung stehen, hängt von der Elastic-Lizenz ab.
