import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { installErrorCapture } from "./utils/consoleErrorBuffer";

// Before the first render so a crash during mount is on record too.
installErrorCapture();

createRoot(document.getElementById("root")!).render(<App />);
