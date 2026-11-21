// Chrome built in Prompt API (Gemini Nano) and Web Speech. Only the parts Twin uses.
type NanoAvailability = 'unavailable' | 'downloadable' | 'downloading' | 'available';

declare global {
  // eslint-disable-next-line no-var
  var LanguageModel:
    | undefined
    | {
        availability(options?: unknown): Promise<NanoAvailability>;
        create(options?: unknown): Promise<{ destroy?: () => void }>;
      };
  // eslint-disable-next-line no-var
  var FIREBASE_APPCHECK_DEBUG_TOKEN: string | boolean | undefined;
  interface Window {
    webkitSpeechRecognition?: any;
    SpeechRecognition?: any;
  }
}

export {};
