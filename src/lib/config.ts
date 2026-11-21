// Routing policy. Defaults live here. Remote Config can change them live for every user
// so the router can be tuned without shipping a new build.
export interface Policy {
  routerThreshold: number; // score needed to try Gemini Nano first
  privacyWeight: number; // how much private data pushes work onto the device
  complexityWeight: number; // how much task difficulty pushes work to the cloud
  deviceTokenLimit: number; // rough input budget for Gemini Nano
  cloudModel: string;
}

export const DEFAULT_POLICY: Policy = {
  routerThreshold: 0.55,
  privacyWeight: 0.45,
  complexityWeight: 0.6,
  deviceTokenLimit: 6000,
  cloudModel: 'gemini-3.5-flash-lite', // Remote Config can change this live without a new build
};

export const policy: Policy = { ...DEFAULT_POLICY };
