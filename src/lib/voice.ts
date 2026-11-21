// Voice in and out. Speech output uses the local speech engine. Speech input asks Chrome to
// recognize on the device when it can. When it cannot, the UI says that audio goes to the browser vendor.
export interface Listener { stop(): void }

export function canListen(): boolean {
  return !!(window.SpeechRecognition || window.webkitSpeechRecognition);
}

export type ListenMode = 'on-device' | 'browser-cloud';

export function listen(
  onText: (t: string, final: boolean) => void,
  onEnd: (mode: ListenMode) => void,
  onError: (e: string) => void,
): Listener {
  const Ctor = window.SpeechRecognition || window.webkitSpeechRecognition;
  const rec = new Ctor();
  rec.lang = 'en-US';
  rec.interimResults = true;
  rec.continuous = false;
  let mode: ListenMode = 'browser-cloud';
  try {
    if ('processLocally' in rec) { rec.processLocally = true; mode = 'on-device'; }
  } catch { /* stays browser cloud */ }
  rec.onresult = (e: any) => {
    const r = e.results[e.results.length - 1];
    onText(r[0].transcript, r.isFinal);
  };
  rec.onerror = (e: any) => {
    // If local recognition is not installed, retry once without it and tell the UI.
    if (mode === 'on-device' && (e.error === 'language-not-supported' || e.error === 'service-not-allowed')) {
      mode = 'browser-cloud';
      try { rec.processLocally = false; rec.start(); return; } catch { /* fall through */ }
    }
    onError(String(e.error));
  };
  rec.onend = () => onEnd(mode);
  rec.start();
  return { stop: () => rec.stop() };
}

export function speak(text: string): void {
  if (!('speechSynthesis' in window)) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  const voices = speechSynthesis.getVoices();
  const local = voices.find((v) => v.localService && v.lang.startsWith('en'));
  if (local) u.voice = local;
  u.rate = 1.02;
  speechSynthesis.speak(u);
}

export const stopSpeaking = () => { if ('speechSynthesis' in window) speechSynthesis.cancel(); };
