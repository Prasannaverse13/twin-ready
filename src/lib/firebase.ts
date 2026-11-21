// Firebase wiring for a normal web page: App Check, AI Logic hybrid models, Auth and Firestore.
import { initializeApp } from 'firebase/app';
import { initializeAppCheck, ReCaptchaV3Provider, ReCaptchaEnterpriseProvider, CustomProvider } from 'firebase/app-check';
import {
  getAI,
  getGenerativeModel,
  GoogleAIBackend,
  InferenceMode,
  type GenerativeModel,
  type Part,
} from 'firebase/ai';
import { getAuth, signInAnonymously, signInWithPopup, signInWithRedirect, getRedirectResult, GoogleAuthProvider, signOut, onAuthStateChanged, type User } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getRemoteConfig, fetchAndActivate, getValue } from 'firebase/remote-config';
import { policy, DEFAULT_POLICY } from './config';
import { WEB_CONFIG, APPCHECK_SITE_KEY } from './webconfig';
import type { Target } from './router';

const env = import.meta.env;

export const firebaseApp = initializeApp(WEB_CONFIG);

// App Check is required by the hackathon. A real site uses reCAPTCHA v3.
// A registered debug token also works for localhost and for judges.
export type AppCheckMode = 'recaptcha' | 'debug' | 'off';
export let appCheckMode: AppCheckMode = 'off';
// On localhost we use a debug token so local demos never fail on a bot score.
// With `true` the SDK makes one token per browser, keeps it in IndexedDB and logs it once.
// Register that token in Firebase console > App Check > Manage debug tokens.
// The deployed site never uses this path. It uses reCAPTCHA Enterprise.
const isLocal = typeof location !== 'undefined' && /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
const debugToken: string | boolean | undefined = env.VITE_APPCHECK_DEBUG_TOKEN || (isLocal ? true : undefined);
if (debugToken) (globalThis as { FIREBASE_APPCHECK_DEBUG_TOKEN?: string | boolean }).FIREBASE_APPCHECK_DEBUG_TOKEN = debugToken;
try {
  const ent = APPCHECK_SITE_KEY || env.VITE_RECAPTCHA_ENTERPRISE_KEY;
  const v3 = env.VITE_RECAPTCHA_V3_KEY;
  if (ent || v3 || debugToken) {
    initializeAppCheck(firebaseApp, {
      // Fraud Defense (reCAPTCHA Enterprise) is the current provider. Classic v3 still works if registered.
      provider: ent
        ? new ReCaptchaEnterpriseProvider(ent)
        : v3
          ? new ReCaptchaV3Provider(v3)
          : new CustomProvider({ getToken: async () => { throw new Error('Debug token mode only'); } }),
      isTokenAutoRefreshEnabled: true,
    });
    appCheckMode = debugToken ? 'debug' : 'recaptcha';
  }
} catch (e) {
  console.warn('[Twin] App Check init failed', e);
}

export const db = getFirestore(firebaseApp);
const ai = getAI(firebaseApp, { backend: new GoogleAIBackend() });

// ---------- Gemini Nano status ----------

export type NanoState = 'unsupported' | 'unavailable' | 'downloadable' | 'downloading' | 'available';

const NANO_OPTS = {
  expectedInputs: [{ type: 'text', languages: ['en'] }],
  expectedOutputs: [{ type: 'text', languages: ['en'] }],
};

export async function nanoState(): Promise<NanoState> {
  if (!globalThis.LanguageModel) return 'unsupported';
  try {
    return await globalThis.LanguageModel.availability(NANO_OPTS);
  } catch {
    return 'unavailable';
  }
}

export async function nanoReady(): Promise<boolean> {
  return (await nanoState()) === 'available';
}

/** Must be called from a click. Starts or finishes the Gemini Nano download. */
export async function downloadNano(onProgress: (p: number) => void): Promise<void> {
  await getModel('device').initializeDeviceModel(onProgress);
}

// ---------- Models ----------

const cache = new Map<string, GenerativeModel>();

function getModel(target: Target, json?: object): GenerativeModel {
  const key = `${target}|${policy.cloudModel}|${json ? JSON.stringify(json) : ''}`;
  let m = cache.get(key);
  if (!m) {
    m = getGenerativeModel(ai, {
      mode: target === 'device' ? InferenceMode.ONLY_ON_DEVICE : InferenceMode.ONLY_IN_CLOUD,
      inCloudParams: {
        model: policy.cloudModel,
        generationConfig: json ? { responseMimeType: 'application/json', temperature: 0.3 } : { temperature: 0.5 },
      },
      onDeviceParams: {
        createOptions: { ...NANO_OPTS, temperature: 0.4, topK: 3 } as any,
        promptOptions: json ? { responseConstraint: json } : undefined,
      },
    });
    cache.set(key, m);
  }
  return m;
}

export interface GenResult { text: string; source: 'on_device' | 'in_cloud'; ms: number }

async function generate(target: Target, prompt: string | (string | Part)[], json?: object): Promise<GenResult> {
  const t0 = performance.now();
  const r = await getModel(target, json).generateContent(prompt as any);
  const text = r.response.text();
  const source = (r.response.inferenceSource ?? (target === 'device' ? 'on_device' : 'in_cloud')) as GenResult['source'];
  if (target === 'device' && source !== 'on_device') {
    // ONLY_ON_DEVICE should never do this. If it ever does, treat it as a privacy fault.
    throw new Error('Expected on device inference but the SDK reported cloud');
  }
  return { text, source, ms: Math.round(performance.now() - t0) };
}

/** Nano with image input. Used to read photos of handwritten notes on the device. */
let imageModel: GenerativeModel | null = null;
export async function deviceReadImage(file: Blob, instruction: string): Promise<GenResult> {
  if (!/^image\/(png|jpeg)$/.test(file.type)) throw new Error('Use a PNG or JPEG image');
  imageModel ??= getGenerativeModel(ai, {
    mode: InferenceMode.ONLY_ON_DEVICE,
    inCloudParams: { model: policy.cloudModel },
    onDeviceParams: {
      createOptions: {
        expectedInputs: [{ type: 'text', languages: ['en'] }, { type: 'image' }],
        expectedOutputs: [{ type: 'text', languages: ['en'] }],
        temperature: 0.2, topK: 3,
      } as any,
    },
  });
  const data = await new Promise<string>((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => res(String(fr.result).split(',')[1]);
    fr.onerror = rej;
    fr.readAsDataURL(file);
  });
  const t0 = performance.now();
  const r = await imageModel.generateContent([instruction, { type: 'inlineData', inlineData: { mimeType: file.type, data } } as any]);
  const source = (r.response.inferenceSource ?? 'on_device') as GenResult['source'];
  if (source !== 'on_device') throw new Error('Expected on device inference but the SDK reported cloud');
  return { text: r.response.text(), source, ms: Math.round(performance.now() - t0) };
}

/** Private input is allowed here. It never leaves the device. */
export const deviceGenerate = (prompt: string | (string | Part)[], json?: object) => generate('device', prompt, json);

/**
 * Do not call this directly for owner data. Use cloudGenerate in egress.ts which runs the
 * egress firewall and writes the leak ledger before anything is sent.
 */
export const unsafeCloudGenerate = (prompt: string, json?: object) => generate('cloud', prompt, json);

/** Visitor page only. The prompt holds the public card and a visitor question. No owner secrets exist here. */
export const publicCloudGenerate = (prompt: string) => generate('cloud', prompt);

// ---------- Remote Config ----------

/** Router weights and the cloud model can be tuned for every user without a new build. */
export async function loadPolicy(): Promise<boolean> {
  try {
    const rc = getRemoteConfig(firebaseApp);
    rc.settings.minimumFetchIntervalMillis = 60_000;
    rc.defaultConfig = {
      router_threshold: DEFAULT_POLICY.routerThreshold,
      privacy_weight: DEFAULT_POLICY.privacyWeight,
      complexity_weight: DEFAULT_POLICY.complexityWeight,
      device_token_limit: DEFAULT_POLICY.deviceTokenLimit,
      cloud_model: DEFAULT_POLICY.cloudModel,
    };
    await fetchAndActivate(rc);
    policy.routerThreshold = getValue(rc, 'router_threshold').asNumber();
    policy.privacyWeight = getValue(rc, 'privacy_weight').asNumber();
    policy.complexityWeight = getValue(rc, 'complexity_weight').asNumber();
    policy.deviceTokenLimit = getValue(rc, 'device_token_limit').asNumber();
    policy.cloudModel = getValue(rc, 'cloud_model').asString() || DEFAULT_POLICY.cloudModel;
    return true;
  } catch (e) {
    console.warn('[Twin] Remote Config unavailable, using defaults', e);
    return false;
  }
}

// ---------- Auth ----------

const auth = () => getAuth(firebaseApp);

// A real person is a user who signed in with Google. Guests are anonymous.
export async function realUser(): Promise<User | null> {
  await auth().authStateReady();
  const u = auth().currentUser;
  return u && !u.isAnonymous ? u : null;
}

export function onUserChange(fn: (u: User | null) => void): void {
  onAuthStateChanged(auth(), (u) => fn(u && !u.isAnonymous ? u : null));
}

export async function finishRedirect(): Promise<void> {
  try { await getRedirectResult(auth()); } catch (e) { console.warn('[Twin] Redirect sign in failed', e); }
}

export async function googleSignIn(): Promise<void> {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  try {
    await signInWithPopup(auth(), provider);
  } catch (e) {
    const code = (e as { code?: string }).code ?? '';
    if (code === 'auth/popup-blocked' || code === 'auth/operation-not-supported-in-this-environment') {
      await signInWithRedirect(auth(), provider);
      return;
    }
    if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') throw new Error('Sign in was closed. Try again.');
    throw e;
  }
}

let anon: Promise<User | null> | null = null;
export async function signOutUser(): Promise<void> { await signOut(auth()); anon = null; }

export async function currentUser(): Promise<User | null> {
  try {
    await auth().authStateReady();
    if (auth().currentUser) return auth().currentUser;
    anon ??= signInAnonymously(auth()).then((c) => c.user);
    return await anon;
  } catch (e) {
    console.warn('[Twin] Sign in failed', e);
    anon = null;
    return null;
  }
}
