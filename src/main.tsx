import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { installErrorCapture } from "./utils/consoleErrorBuffer";

// Before the first render so a crash during mount is on record too.
installErrorCapture();

// The rest timer's "Rest complete" notification goes through this
// registration's showNotification (restTimerScheduler.ts): Chrome for Android
// rejects the page-level Notification constructor. public/sw.js handles
// nothing but the notification click.
if (import.meta.env.MODE !== "test" && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch((e) => {
      console.warn("[sw] registration failed:", e);
    });
  });
}

createRoot(document.getElementById("root")!).render(<App />);
