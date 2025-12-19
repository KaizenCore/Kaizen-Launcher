import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";
import { ThemeProvider } from "./components/layout/ThemeProvider";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <ThemeProvider>
    <App />
  </ThemeProvider>
);
