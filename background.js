// Background service worker
// Keeps the toolbar action icon in sync with the selected theme.

const THEME_ICONS = {
  advantage: "geden-logo.png",
  geden: "geden-logo.png"
};

const applyThemeIcon = (theme) => {
  const file = THEME_ICONS[theme] || THEME_ICONS.advantage;
  const path = { 16: file, 32: file, 48: file, 128: file };
  // setIcon returns a promise in MV3; ignore failures (e.g. transient worker teardown).
  chrome.action.setIcon({ path }).catch(() => {});
};

// Apply on install and on every service-worker startup.
const init = () => {
  chrome.storage.local.get(["theme"], (result) => {
    applyThemeIcon(result.theme || "advantage");
  });
};

chrome.runtime.onInstalled.addListener(init);
chrome.runtime.onStartup.addListener(init);

// React live to theme changes made from the popup.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.theme) {
    applyThemeIcon(changes.theme.newValue || "advantage");
  }
});

// Run once when the worker spins up.
init();
