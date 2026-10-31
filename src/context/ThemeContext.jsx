import { createContext, useContext, useEffect, useState } from "react";

const ThemeContext = createContext();

const DEFAULT_BRANDING = {
  // ── Edit these to rebrand the whole app (tab title, favicon, colours). ──
  companyName:    "SkyUp CRM",         // shown in the browser tab
  logo:           "",                  // empty → login header shows the companyName text ("SkyUp CRM"). Point to a real SkyUp logo in /public to show an image instead.
  favicon:        "/skyup_logo.svg",   // drop a small square icon in /public and point here
  primaryColor:   "#2563EB",
  secondaryColor: "#1E40AF",
};

export function ThemeProvider({ children }) {
  const [dark, setDark] = useState(
    () => localStorage.getItem("theme") === "dark"
  );

  // Static branding — no API call. Swap DEFAULT_BRANDING values here if needed.
  const [branding] = useState(DEFAULT_BRANDING);

  // ── Apply dark/light class ─────────────────────────────────────────────────
  useEffect(() => {
    const root = document.documentElement;
    if (dark) {
      root.classList.add("dark");
      localStorage.setItem("theme", "dark");
    } else {
      root.classList.remove("dark");
      localStorage.setItem("theme", "light");
    }
  }, [dark]);

  // ── Apply CSS custom properties whenever branding changes ─────────────────
  useEffect(() => {
    document.documentElement.style.setProperty("--primary", branding.primaryColor);
    document.documentElement.style.setProperty("--secondary", branding.secondaryColor);

    // Tab title.
    if (branding.companyName) document.title = branding.companyName;

    // Favicon. index.html now ships a <link rel="icon">, but create one if it's
    // ever missing so the icon still updates instead of silently no-op'ing.
    let favicon = document.querySelector("link[rel='icon']");
    if (!favicon) {
      favicon = document.createElement("link");
      favicon.rel = "icon";
      document.head.appendChild(favicon);
    }
    favicon.href = branding.favicon || "/favicon.svg";
  }, [branding]);

  const toggle = () => setDark((prev) => !prev);

  return (
    <ThemeContext.Provider value={{ dark, toggle, branding }}>
      {children}
    </ThemeContext.Provider>
  );
}

export const useTheme = () => useContext(ThemeContext);
