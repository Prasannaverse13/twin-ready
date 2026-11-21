# Twin

## Inspiration
AI assistants that remember you store your life on their servers. We wanted a twin that knows you deeply but where the cloud never owns your memory.

## What it does
Twin is a website and a Chrome extension. Sign in with Google and talk to your twin. Paste notes or a photo of a handwritten page. Gemini Nano turns them into memories on your device inside an AES encrypted vault. Ask your twin what you would do and it answers out loud in your style. A second public twin lives on the internet, knows only what you approve, talks to visitors and takes messages. Your private twin drafts the replies. In the Chrome extension two agents (Scout and Keeper) read the page you are on and teach your twin, so you never copy and paste. The extension links to one account only and the web app is the twin storage.

## How we built it
Firebase AI Logic hybrid inference is the core. A learning router scores each task for privacy and difficulty and tracks how often Nano passes a checker. Easy or very private tasks run on Nano. Hard ones go to cloud Gemini after a three layer shield replaces every name, place and ID with tags. A fail closed egress firewall blocks any payload that still shows a private value and logs every byte in a ledger. Answers are rehydrated on the device. Firestore holds only approved public cards behind strict rules. App Check (reCAPTCHA Enterprise), Google and Anonymous Authentication, Remote Config and Hosting complete the stack. Live at https://twin-hybrid-gm.web.app and free on the Spark plan.

## Non obvious use of hybrid AI
The split between device and cloud is a memory boundary. The cloud model is a stateless brain. The device is the only place your memory exists.

## Platform
Web (Chrome): a web app plus a Chrome extension. All inference goes through Firebase AI Logic. Nano uses InferenceMode.ONLY_ON_DEVICE. Cloud Gemini uses InferenceMode.ONLY_IN_CLOUD. The router picks the mode per task.

## Challenges
Nano is small, so every Nano output is checked. Extracted memories must be grounded in the source notes or they are dropped.

## What we learned
Privacy can be shown, not just claimed. The ledger and the red team test let anyone verify it.

## What is next
On device voice when Chrome ships it everywhere, and a native iOS app.
