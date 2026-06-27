const net = require("net");
const { spawnSync, spawn } = require("child_process");

module.exports = (fs, logger, sql, app_cfg) => {
  // ffmpeg-Verfügbarkeit beim Start prüfen
  const _ffmpegCheck = spawnSync("ffmpeg", ["-version"], { stdio: "ignore" });
  if (_ffmpegCheck.error) {
    logger.log("warn", "ffmpeg nicht gefunden! TTS-Erstellung wird fehlschlagen. Bitte ffmpeg installieren.");
  }

  // Wyoming-Protokoll: Text an Piper senden und PCM-Audio empfangen
  const synthesize_wyoming = (host, port, voice, text) => {
    return new Promise((resolve, reject) => {
      let settled = false;
      let timer;
      const done = (val) => { if (settled) return; settled = true; clearTimeout(timer); client.destroy(); resolve(val); };
      const fail = (err) => { if (settled) return; settled = true; clearTimeout(timer); client.destroy(); reject(err); };

      const client = net.createConnection({ host, port }, () => {
        client.write(JSON.stringify({ type: "synthesize", data: { text, voice: { name: voice } } }) + "\n");
      });

      const audioChunks = [];
      let audioInfo = null;
      let buf = Buffer.alloc(0);
      let payloadLeft = 0;

      client.on("data", (data) => {
        buf = Buffer.concat([buf, data]);
        while (buf.length > 0) {
          if (payloadLeft > 0) {
            if (buf.length < payloadLeft) break;
            audioChunks.push(Buffer.from(buf.slice(0, payloadLeft)));
            buf = buf.slice(payloadLeft);
            payloadLeft = 0;
          } else {
            const nl = buf.indexOf(10); // '\n'
            if (nl === -1) break;
            let msg;
            try { msg = JSON.parse(buf.slice(0, nl).toString()); } catch (_) { buf = buf.slice(nl + 1); continue; }
            buf = buf.slice(nl + 1);
            if (msg.type === "audio-start") {
              audioInfo = msg.data;
            } else if (msg.type === "audio-chunk") {
              payloadLeft = msg.payload_length || 0;
            } else if (msg.type === "audio-stop") {
              done({ audioInfo, chunks: audioChunks });
            } else if (msg.type === "error") {
              fail(new Error("Piper Fehler: " + JSON.stringify(msg.data)));
            }
          }
        }
      });

      timer = setTimeout(() => fail(new Error("Piper Wyoming Timeout nach 30s")), 30000);
      client.on("error", fail);
      client.on("close", () => { if (!settled) fail(new Error("Piper Wyoming: Verbindung unerwartet geschlossen")); });
    });
  };

  // WAV-Datei aus PCM-Rohdaten und Audio-Metadaten zusammenbauen
  const write_wav = (filepath, audioInfo, chunks) => {
    const pcm = Buffer.concat(chunks);
    const { rate, width, channels } = audioInfo;
    const hdr = Buffer.alloc(44);
    hdr.write("RIFF", 0);
    hdr.writeUInt32LE(36 + pcm.length, 4);
    hdr.write("WAVE", 8);
    hdr.write("fmt ", 12);
    hdr.writeUInt32LE(16, 16);
    hdr.writeUInt16LE(1, 20);   // PCM
    hdr.writeUInt16LE(channels, 22);
    hdr.writeUInt32LE(rate, 24);
    hdr.writeUInt32LE(rate * channels * width, 28);
    hdr.writeUInt16LE(channels * width, 32);
    hdr.writeUInt16LE(width * 8, 34);
    hdr.write("data", 36);
    hdr.writeUInt32LE(pcm.length, 40);
    fs.writeFileSync(filepath, Buffer.concat([hdr, pcm]));
  };

  // Konstanten für TTS-Konfiguration
  const TTS_CONFIG = {
    audio: {
      sampleRate: 44100,
      channels: 2,
      bitrate: "128k",
    },
    fileExtensions: {
      wav: ".wav",
      mp3: ".mp3",
      tmp: "_tmp.mp3",
    },
  };

  // Plattform-spezifische TTS-Implementierungen
  const ttsImplementations = {
    win32: {
      createTTS: async (tts_text, wav_tts, mp3_tmp, mp3_tts, mp3_bell) => {
        const pwshell_commands = [
          `
          Add-Type -AssemblyName System.speech;
          $speak = New-Object System.Speech.Synthesis.SpeechSynthesizer;
          $speak.SetOutputToWaveFile("${wav_tts}");
          $speak.Speak("${tts_text}");
          $speak.Dispose();
          ffmpeg -nostats -hide_banner -loglevel 0 -y -i ${wav_tts} -vn -ar ${TTS_CONFIG.audio.sampleRate} -ac ${TTS_CONFIG.audio.channels} -ab ${TTS_CONFIG.audio.bitrate} -f mp3 ${mp3_tmp};
          ffmpeg -nostats -hide_banner -loglevel 0 -y -i "concat:${mp3_bell}|${mp3_tmp}" -acodec copy ${mp3_tts};
          rm ${wav_tts};
          rm ${mp3_tmp};
          `,
        ];

        return new Promise((resolve, reject) => {
          const pwshell_childD = spawn("powershell", pwshell_commands, { shell: true });

          pwshell_childD.stderr.on("data", (data) => {
            reject(new Error(`Fehler beim Erstellen der TTS-Datei (win32): ${data}`));
          });

          pwshell_childD.on("exit", (code) => {
            if (code === 0) {
              resolve();
            } else {
              reject(new Error(`Powershell-Prozess beendet mit Code ${code}`));
            }
          });

          pwshell_childD.stdin.end();
        });
      },
    },
    linux: {
      createTTS: async (tts_text, wav_tts, mp3_tmp, mp3_tts, mp3_bell) => {
        const lxshell_commands = [
          "-c",
          `
          pico2wave --lang=de-DE --wave=${wav_tts} "${tts_text}"
          ffmpeg -nostats -hide_banner -loglevel 0 -y -i ${wav_tts} -vn -ar ${TTS_CONFIG.audio.sampleRate} -ac ${TTS_CONFIG.audio.channels} -ab ${TTS_CONFIG.audio.bitrate} -f mp3 ${mp3_tmp}
          ffmpeg -nostats -hide_banner -loglevel 0 -y -i "concat:${mp3_bell}|${mp3_tmp}" -acodec copy ${mp3_tts}
          rm ${wav_tts}
          rm ${mp3_tmp}`,
        ];

        const maxAttempts = 3;
        const retryDelayMs = 500;

        const runOnce = () => {
          return new Promise((resolve, reject) => {
            const lxshell_childD = spawn("/bin/sh", lxshell_commands, { shell: true });
            let stderr = "";

            lxshell_childD.stderr.on("data", (data) => {
              stderr += data.toString();
            });

            lxshell_childD.on("error", (err) => {
              reject(err);
            });

            lxshell_childD.on("exit", (code) => {
              if (code === 0) {
                resolve();
              } else {
                reject(new Error(`Linux TTS-Prozess beendet mit Code ${code}. ${stderr}`));
              }
            });

            lxshell_childD.stdin.end();
          });
        };

        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
          try {
            if (attempt > 1) logger.log("log", `TTS-Versuch ${attempt}/${maxAttempts} für ${wav_tts}`);
            await runOnce();
            if (attempt > 1) logger.log("log", `TTS erfolgreich nach ${attempt} Versuch(en) für ${wav_tts}`);
            return;
          } catch (err) {
            logger.log("warn", `TTS-Versuch ${attempt}/${maxAttempts} fehlgeschlagen: ${err.message}`);
            if (attempt < maxAttempts) {
              await new Promise((r) => setTimeout(r, retryDelayMs));
            } else {
              throw new Error(`Linux TTS-Prozess nach ${maxAttempts} Versuchen fehlgeschlagen: ${err.message}`);
            }
          }
        }
      },
    },
    piper: {
      createTTS: async (tts_text, wav_tts, mp3_tmp, mp3_tts, mp3_bell) => {
        // WAV via Wyoming-Protokoll von Piper holen und schreiben
        const { audioInfo, chunks } = await synthesize_wyoming(
          app_cfg.tts.piper_host,
          app_cfg.tts.piper_port,
          app_cfg.tts.piper_voice,
          tts_text
        );
        write_wav(wav_tts, audioInfo, chunks);

        // ffmpeg: WAV → MP3 (temporär), dann Gong + TTS zusammenfügen
        const run_ffmpeg = (args) => new Promise((res, rej) => {
          const p = spawn("ffmpeg", args);
          let stderr = "";
          p.stderr.on("data", (d) => { stderr += d.toString(); });
          p.on("error", rej);
          p.on("exit", (code) => code === 0 ? res() : rej(new Error(`ffmpeg Code ${code}: ${stderr}`)));
        });

        await run_ffmpeg([
          "-nostats", "-hide_banner", "-loglevel", "0", "-y",
          "-i", wav_tts,
          "-vn", "-ar", String(TTS_CONFIG.audio.sampleRate),
          "-ac", String(TTS_CONFIG.audio.channels),
          "-ab", TTS_CONFIG.audio.bitrate,
          "-f", "mp3", mp3_tmp,
        ]);
        await run_ffmpeg([
          "-nostats", "-hide_banner", "-loglevel", "0", "-y",
          "-i", `concat:${mp3_bell}|${mp3_tmp}`,
          "-acodec", "copy", mp3_tts,
        ]);

        try { fs.unlinkSync(wav_tts); } catch (_) {}
        try { fs.unlinkSync(mp3_tmp); } catch (_) {}
      },
    },
  };

  const tts_erstellen = async (einsatzdaten, wachen_nr) => {
    try {
      let full_half = "";
      if (einsatzdaten.permissions) {
        // Berechtigungen vorhanden, volle Einsatzdaten verwenden
        full_half = "full";
      } else {
        // Berechtigungen nicht vorhanden, reduzierte Einsatzdaten verwenden
        full_half = "half";
      }

      // Einsatz-UUID inkl. Wachennummer und Permissions als Dateinamen verwenden und unnötige Zeichen entfernen
      const id = einsatzdaten.uuid.replace(/\W/g, "") + "_" + wachen_nr + "_" + full_half;
      const soundPath = process.cwd() + app_cfg.global.soundpath;
      const mediaPath = app_cfg.global.mediapath;

      // Pfade der Sound-Dateien definieren
      const wav_tts = soundPath + id + TTS_CONFIG.fileExtensions.wav;
      const mp3_tmp = soundPath + id + TTS_CONFIG.fileExtensions.tmp;
      const mp3_tts = soundPath + id + TTS_CONFIG.fileExtensions.mp3;
      const mp3_url = mediaPath + id + TTS_CONFIG.fileExtensions.mp3;

      // Prüfen ob mp3 bereits existiert
      if (fs.existsSync(mp3_tts)) {
        return mp3_url;
      }

      // Alarmgong basierend auf Einsatzart wählen
      const mp3_bell =
        soundPath +
        (einsatzdaten.einsatzart === "Brandeinsatz" || einsatzdaten.einsatzart === "Hilfeleistungseinsatz" ? "bell_long.mp3" : "bell_short.mp3");

      // Sprachansage Text erstellen
      let tts_text = `${einsatzdaten.einsatzart}, ${einsatzdaten.stichwort}. `;
      // Orts-/Objekt-Text zusammensetzen ohne 'null' oder leere Teile
      const locParts = [];
      if (einsatzdaten.objektteil) locParts.push(einsatzdaten.objektteil);
      if (einsatzdaten.objekt) locParts.push(einsatzdaten.objekt);
      if (einsatzdaten.ort) locParts.push(einsatzdaten.ort);
      // Ortsteil nur anhängen, wenn vorhanden und nicht identisch zu Ort (case-insensitive)
      if (einsatzdaten.ortsteil && (!einsatzdaten.ort || einsatzdaten.ortsteil.toLowerCase() !== einsatzdaten.ort.toLowerCase())) {
        locParts.push(einsatzdaten.ortsteil);
      }
      tts_text += locParts.join(", ");

      // Textersetzungen aus Datenbank laden in TTS-Text durchführen
      tts_text = await sql.db_tts_ortsdaten(tts_text);

      // Einsatzmittel TTS-Text verarbeiten
      await Promise.all(einsatzdaten.em_alarmiert.map((em) => sql.db_tts_einsatzmittel(em)));
      const tts_text_em_alarmiert = einsatzdaten.em_alarmiert.map((em) => em.tts_text).join(", ");
      tts_text += `. Für ${tts_text_em_alarmiert}`;

      // Sondersignal hinzufügen
      tts_text += einsatzdaten.sondersignal == 1 ? ", mit Sondersignal" : ", ohne Sonderrechte";
      tts_text += ". Ende der Durchsage!";

      // Ungewollte Zeichen entfernen
      tts_text = tts_text.replace(/[:/-]/g, " ");

      // TTS-Provider auswählen: Piper (wenn konfiguriert) oder plattformspezifisch
      const ttsProvider = (app_cfg.tts && app_cfg.tts.provider === "piper")
        ? ttsImplementations.piper
        : ttsImplementations[process.platform];

      if (!ttsProvider) {
        throw new Error(`TTS nicht verfügbar (Provider: ${app_cfg.tts?.provider || process.platform})`);
      }

      await ttsProvider.createTTS(tts_text, wav_tts, mp3_tmp, mp3_tts, mp3_bell);
      return mp3_url;
    } catch (error) {
      // Fallback: Standard-Gong zurückgeben, wenn TTS-Erstellung fehlschlägt
      const bkp_mp3_bell =
        app_cfg.global.mediapath +
        (einsatzdaten.einsatzart === "Brandeinsatz" || einsatzdaten.einsatzart === "Hilfeleistungseinsatz" ? "bell_long.mp3" : "bell_short.mp3");
      logger.log("warn", `TTS-Erstellung fehlgeschlagen, sende nur Gong. Fehler: ${error.message}`);
      return bkp_mp3_bell;
    }
  };

  return { tts_erstellen };
};
