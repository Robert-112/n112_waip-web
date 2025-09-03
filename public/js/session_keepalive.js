// Session Keep-Alive Script
// Verlängert die Lebenszeit der Session durch periodische Aufrufe eines Endpunkts.
// Nutzt die vom Server konfigurierte maximale Cookie-Lebensdauer und ruft etwa alle 40% davon den Endpunkt auf.

(function(){
  if (!window || !window.fetch) return;
  const DEFAULT_INTERVAL = 60000; // Fallback 60s
  const MAX_AGE = window.session_max_age || DEFAULT_INTERVAL; // vom Server injiziert (angepasster Variablenname)
  // alle 80% der MaxAge einen KeepAlive, aber mindestens alle 55 Sekunden, höchstens alle 5 Minuten
  const interval = Math.min(Math.max(Math.floor(MAX_AGE * 0.8), 55000), 5*60*1000);
  let timerId = null;

  async function ping(){
    try {
      const resp = await fetch('/session/keepalive', {cache: 'no-store'});
      if (!resp.ok){
        console.warn('Session KeepAlive fehlgeschlagen:', resp.status);
        /*if (resp.status === 440) {
          // Session abgelaufen -> Reload, damit ggf. Login angezeigt wird
            window.location.reload();
        }*/
      } else {
        const data = await resp.json();
        console.debug('Session verlängert bis', data.expires);
      }
    } catch (e){
      console.warn('Session KeepAlive Fehler:', e);
    }
  }

  function start(){
    if (timerId) return;
    timerId = window.setInterval(ping, interval);
    // sofort einmal ausführen nach kurzer Verzögerung, damit Seite erst fertig lädt
    window.setTimeout(ping, 5000);
  }

  // Start wenn DOM bereit
  if (document.readyState === 'complete' || document.readyState === 'interactive'){
    start();
  } else {
    document.addEventListener('DOMContentLoaded', start);
  }
})();
