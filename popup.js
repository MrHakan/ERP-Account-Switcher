// ERP Account Switcher — Popup Logic
// Geden Lines ERP & GMS portals: domain-aware login, theming, reload-from-disk,
// pinning, inline token editing, quick portal access and token-age warnings.

// ===== Static config =====

const THEMES = {
  advantage: { name: "Geden Lines", logo: "geden-logo.png", toggleLabel: "GedenRed", next: "geden" },
  geden:     { name: "Geden Lines",       logo: "geden-logo.png",     toggleLabel: "GedenBlue", next: "advantage" }
};
const DEFAULT_THEME = "advantage";

// Per-portal logout/login routing. Keys are URL hosts.
const PORTAL_CONFIG = {
  "app.gedenlines.com": { logoutPath: "/Account/Logout", loginPath: "/Account/Logon", label: "ERP", dotClass: "erp" },
  "gms.gedenlines.com": { logoutPath: "/Logout",         loginPath: "/login",         label: "GMS", dotClass: "gms" }
};

// "Open portal" quick links.
const PORTALS = {
  erp: "https://app.gedenlines.com/Account/Logon",
  gms: "https://gms.gedenlines.com/login"
};

// Tokens are rotated weekly — warn once a file is older than this.
const STALE_MS = 7 * 24 * 60 * 60 * 1000;

// ===== Tiny IndexedDB store for FileSystemFileHandles (so we can re-read on reload) =====

const DB_NAME = "erp-switcher";
const HANDLE_STORE = "handles";

const openHandleDB = () => new Promise((resolve, reject) => {
  const req = indexedDB.open(DB_NAME, 1);
  req.onupgradeneeded = () => req.result.createObjectStore(HANDLE_STORE);
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});

const idbSetHandle = async (key, value) => {
  const db = await openHandleDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(HANDLE_STORE, "readwrite");
    tx.objectStore(HANDLE_STORE).put(value, key);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => reject(tx.error);
  });
};

const idbGetHandle = async (key) => {
  const db = await openHandleDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(HANDLE_STORE, "readonly");
    const r = tx.objectStore(HANDLE_STORE).get(key);
    r.onsuccess = () => { db.close(); resolve(r.result); };
    r.onerror = () => reject(r.error);
  });
};

// Human-friendly "x ago" from a timestamp.
const humanAge = (ts) => {
  if (!ts) return "";
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} hour${hrs > 1 ? "s" : ""} ago`;
  const days = Math.floor(hrs / 24);
  return `${days} day${days > 1 ? "s" : ""} ago`;
};

document.addEventListener('DOMContentLoaded', async () => {
  // ===== UI Selectors =====
  const tabs = document.querySelectorAll('.tab-btn');
  const panes = document.querySelectorAll('.content-pane');
  const searchBar = document.getElementById('search-bar');
  const reloadBtn = document.getElementById('reload-btn');
  const vesselAccountContainer = document.getElementById('vessel-account-container');
  const vesselSection = document.getElementById('vessel-section');
  const crewListContainer = document.getElementById('crew-list-container');

  const vesselDropzone = document.getElementById('vessel-dropzone');
  const crewDropzone = document.getElementById('crew-dropzone');
  const vesselFileInput = document.getElementById('vessel-file-input');
  const crewFileInput = document.getElementById('crew-file-input');

  const vesselFilename = document.getElementById('vessel-filename');
  const vesselFilestatus = document.getElementById('vessel-filestatus');
  const vesselFilemeta = document.getElementById('vessel-filemeta');
  const crewFilename = document.getElementById('crew-filename');
  const crewFilestatus = document.getElementById('crew-filestatus');
  const crewFilemeta = document.getElementById('crew-filemeta');

  const vesselUsernameInput = document.getElementById('vessel-username-input');
  const vesselPasswordLabel = document.getElementById('vessel-password-label');
  const vesselPasswordInput = document.getElementById('vessel-password-input');
  const saveSettingsBtn = document.getElementById('save-settings-btn');

  const themeToggle = document.getElementById('theme-toggle');
  const themeToggleLabel = document.getElementById('theme-toggle-label');
  const brandIcon = document.getElementById('brand-icon');
  const brandTitle = document.getElementById('brand-title');

  const portalDot = document.getElementById('portal-dot');
  const portalText = document.getElementById('portal-text');
  const openErpBtn = document.getElementById('open-erp');
  const openGmsBtn = document.getElementById('open-gms');
  const acctCount = document.getElementById('acct-count');

  // ===== Application State =====
  let appState = {
    theme: DEFAULT_THEME,
    vessel: null, // { username, token }
    crew: [],     // [{ rank, name, email, password, token }]
    settings: {
      vesselUsername: "ASPRING",
      vesselPassword: ""
    },
    loadedFiles: { vessel: "", crew: "" },
    loadedAt: { vessel: null, crew: null },
    pinned: []    // crew emails pinned to the top
  };

  // Runtime-only badge state: 'missing' | 'loaded' | 'error'
  const fileState = { vessel: "missing", crew: "missing" };

  // ===== Toast =====
  const showToast = (message) => {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 2200);
  };

  // ===== Edit-token modal =====
  const editModal = document.getElementById('edit-modal');
  const editModalSub = document.getElementById('edit-modal-sub');
  const editModalInput = document.getElementById('edit-modal-input');
  const editModalSave = document.getElementById('edit-modal-save');
  const editModalCancel = document.getElementById('edit-modal-cancel');
  let pendingTokenSave = null;

  const closeEditModal = () => {
    editModal.classList.remove('show');
    pendingTokenSave = null;
  };

  // Open the modal to edit a token. onSave(newToken) is called when confirmed.
  const openEditTokenModal = (subtitle, currentToken, onSave) => {
    editModalSub.textContent = subtitle;
    editModalInput.value = currentToken || "";
    pendingTokenSave = onSave;
    editModal.classList.add('show');
    editModalInput.focus();
    editModalInput.select();
  };

  const commitTokenEdit = () => {
    const newToken = editModalInput.value.trim();
    if (!newToken) {
      showToast("Token cannot be empty.");
      return;
    }
    if (pendingTokenSave) pendingTokenSave(newToken);
    closeEditModal();
  };

  editModalSave.addEventListener('click', commitTokenEdit);
  editModalCancel.addEventListener('click', closeEditModal);
  editModal.addEventListener('click', (e) => { if (e.target === editModal) closeEditModal(); });
  editModalInput.addEventListener('keydown', (e) => {
    if (e.key === "Enter") commitTokenEdit();
    else if (e.key === "Escape") closeEditModal();
  });

  // ===== Navigation =====
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('active'));
      panes.forEach(p => p.classList.remove('active'));
      tab.classList.add('active');
      const targetPane = document.getElementById(tab.dataset.tab);
      if (targetPane) targetPane.classList.add('active');
    });
  });

  // ===== Storage sync =====
  const loadStateFromStorage = () => new Promise(resolve => {
    chrome.storage.local.get(['theme', 'vessel', 'crew', 'settings', 'loadedFiles', 'loadedAt', 'pinned'], (result) => {
      if (result.theme && THEMES[result.theme]) appState.theme = result.theme;
      if (result.vessel) appState.vessel = result.vessel;
      if (result.crew) appState.crew = result.crew;
      if (result.settings) appState.settings = { ...appState.settings, ...result.settings };
      if (result.loadedFiles) appState.loadedFiles = { ...appState.loadedFiles, ...result.loadedFiles };
      if (result.loadedAt) appState.loadedAt = { ...appState.loadedAt, ...result.loadedAt };
      if (Array.isArray(result.pinned)) appState.pinned = result.pinned;
      resolve();
    });
  });

  const saveStateToStorage = () => new Promise(resolve => {
    chrome.storage.local.set({
      theme: appState.theme,
      vessel: appState.vessel,
      crew: appState.crew,
      settings: appState.settings,
      loadedFiles: appState.loadedFiles,
      loadedAt: appState.loadedAt,
      pinned: appState.pinned
    }, () => resolve());
  });

  // ===== Theme =====
  const applyTheme = () => {
    const t = THEMES[appState.theme] || THEMES[DEFAULT_THEME];
    document.body.setAttribute('data-theme', appState.theme);
    brandIcon.src = t.logo;
    brandTitle.textContent = t.name;
    themeToggleLabel.textContent = t.toggleLabel;
  };

  const setTheme = async (theme) => {
    if (!THEMES[theme]) return;
    appState.theme = theme;
    applyTheme();
    // Persist theme on its own too so the background worker can swap the toolbar icon.
    chrome.storage.local.set({ theme });
    await saveStateToStorage();
  };

  themeToggle.addEventListener('click', async () => {
    const next = THEMES[appState.theme].next;
    await setTheme(next);
    // Still hovering after the swap — preview the new "next" target.
    if (themeToggle.matches(':hover')) {
      themeToggle.dataset.preview = THEMES[appState.theme].next;
    }
  });

  // Hover preview: button takes on the look of the theme it will switch to.
  themeToggle.addEventListener('mouseenter', () => {
    themeToggle.dataset.preview = THEMES[appState.theme].next;
  });
  themeToggle.addEventListener('mouseleave', () => {
    delete themeToggle.dataset.preview;
  });

  // ===== Pinning =====
  const isPinned = (email) => appState.pinned.includes(email);

  const togglePin = async (email) => {
    if (isPinned(email)) {
      appState.pinned = appState.pinned.filter(e => e !== email);
    } else {
      appState.pinned = [...appState.pinned, email];
    }
    await saveStateToStorage();
    renderAccounts(searchBar.value || "");
  };

  // ===== File status badge + age =====
  const renderFileBadge = (type) => {
    const nameEl = type === "vessel" ? vesselFilename : crewFilename;
    const badgeEl = type === "vessel" ? vesselFilestatus : crewFilestatus;
    const metaEl = type === "vessel" ? vesselFilemeta : crewFilemeta;
    const defaultName = type === "vessel" ? "vessel-token.docx" : "crew-tokens.docx";
    const fname = appState.loadedFiles[type];
    const st = fileState[type];

    if (st === "loaded" && fname) {
      nameEl.textContent = fname;
      badgeEl.textContent = "Loaded";
      badgeEl.className = "status-badge loaded";
    } else if (st === "error") {
      nameEl.textContent = fname || defaultName;
      badgeEl.textContent = "Error";
      badgeEl.className = "status-badge error";
    } else {
      nameEl.textContent = defaultName;
      badgeEl.textContent = "Missing";
      badgeEl.className = "status-badge missing";
    }

    const ts = appState.loadedAt[type];
    if (st === "loaded" && ts) {
      const stale = (Date.now() - ts) > STALE_MS;
      metaEl.textContent = `${stale ? "⚠️ " : ""}Updated ${humanAge(ts)}`;
      metaEl.style.color = stale ? "#fbbf24" : "";
    } else {
      metaEl.textContent = "";
    }
  };

  // Reload button warns when any loaded file is stale.
  const refreshReloadWarning = () => {
    const stamps = [appState.loadedAt.vessel, appState.loadedAt.crew].filter(Boolean);
    const stale = stamps.length > 0 && stamps.some(ts => (Date.now() - ts) > STALE_MS);
    reloadBtn.classList.toggle('stale', stale);
    reloadBtn.title = stale
      ? "Tokens may be outdated — reload to refresh from the saved Word files"
      : "Reload & re-parse selected Word files";
  };

  // ===== UI Redraw =====
  const updateUI = () => {
    renderFileBadge("vessel");
    renderFileBadge("crew");
    refreshReloadWarning();

    vesselUsernameInput.value = appState.settings.vesselUsername || "";
    vesselPasswordInput.value = appState.settings.vesselPassword || "";
    vesselPasswordLabel.textContent = `Vessel Password (${appState.settings.vesselUsername || 'ASPRING'})`;

    acctCount.textContent = appState.crew && appState.crew.length ? String(appState.crew.length) : "";

    applyTheme();
    renderAccounts(searchBar.value || "");
  };

  // Escape user-derived strings before injecting into innerHTML.
  const esc = (str) => String(str ?? "").replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));

  const renderAccounts = (filter = "") => {
    vesselAccountContainer.innerHTML = "";
    crewListContainer.innerHTML = "";
    const cleanFilter = filter.toLowerCase().trim();

    // Vessel section
    if (appState.vessel) {
      vesselSection.style.display = "block";
      const vName = "Vessel Account";
      const vEmail = appState.vessel.username || appState.settings.vesselUsername || "ASPRING";

      if (!cleanFilter || vName.toLowerCase().includes(cleanFilter) || vEmail.toLowerCase().includes(cleanFilter)) {
        const card = document.createElement('div');
        card.className = "vessel-card";
        card.innerHTML = `
          <div class="account-info">
            <div class="account-title-row">
              <span class="account-name">${esc(vName)}</span>
              <span class="account-rank-badge vessel-badge">Vessel</span>
            </div>
            <span class="account-email">User: ${esc(vEmail)} | Token: ${esc(appState.vessel.token)}</span>
          </div>
          <div class="card-actions">
            <button class="icon-btn edit-btn" title="Edit token">✏️</button>
            <div class="action-indicator">🔑</div>
          </div>
        `;
        card.addEventListener('click', () => triggerAutofill(appState.vessel.username, appState.settings.vesselPassword, appState.vessel.token));
        card.querySelector('.edit-btn').addEventListener('click', (e) => {
          e.stopPropagation();
          openEditTokenModal(`Vessel Account (${vEmail})`, appState.vessel.token, async (newToken) => {
            appState.vessel.token = newToken;
            await saveStateToStorage();
            renderAccounts(searchBar.value || "");
            showToast("Vessel token updated.");
          });
        });
        vesselAccountContainer.appendChild(card);
      }
    } else {
      vesselSection.style.display = "none";
    }

    // Crew list
    if (appState.crew && appState.crew.length > 0) {
      const filteredCrew = appState.crew.filter(c => {
        if (!cleanFilter) return true;
        return c.name.toLowerCase().includes(cleanFilter) ||
               c.rank.toLowerCase().includes(cleanFilter) ||
               c.email.toLowerCase().includes(cleanFilter);
      });

      // Pinned accounts float to the top (stable within each group).
      const sortedCrew = [...filteredCrew].sort((a, b) =>
        (isPinned(a.email) ? 0 : 1) - (isPinned(b.email) ? 0 : 1)
      );

      if (sortedCrew.length > 0) {
        sortedCrew.forEach(c => {
          const pinned = isPinned(c.email);
          const card = document.createElement('div');
          card.className = "account-card";
          card.innerHTML = `
            <div class="account-info">
              <div class="account-title-row">
                <span class="account-name">${esc(c.name)}</span>
                <span class="account-rank-badge">${esc(c.rank)}</span>
              </div>
              <span class="account-email">${esc(c.email)} | Token: ${esc(c.token)}</span>
            </div>
            <div class="card-actions">
              <button class="icon-btn pin-btn ${pinned ? "pinned" : ""}" title="${pinned ? "Unpin" : "Pin to top"}">${pinned ? "★" : "☆"}</button>
              <button class="icon-btn edit-btn" title="Edit token">✏️</button>
              <div class="action-indicator">➜</div>
            </div>
          `;
          card.addEventListener('click', () => triggerAutofill(c.email, c.password, c.token));
          card.querySelector('.pin-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            togglePin(c.email);
          });
          card.querySelector('.edit-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            openEditTokenModal(`${c.name} — ${c.email}`, c.token, async (newToken) => {
              c.token = newToken;
              await saveStateToStorage();
              renderAccounts(searchBar.value || "");
              showToast("Token updated.");
            });
          });
          crewListContainer.appendChild(card);
        });
      } else {
        crewListContainer.innerHTML = `<div class="empty-state">No matching accounts found for "${esc(filter)}"</div>`;
      }
    } else {
      crewListContainer.innerHTML = `
        <div class="empty-state">
          <span class="empty-state-icon">📂</span>
          No crew data loaded.<br>Upload token files in the Files tab.
        </div>
      `;
    }
  };

  // ===== Portal status + quick open =====
  const updatePortalStatus = async () => {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      const host = tab && tab.url ? new URL(tab.url).host : "";
      const config = PORTAL_CONFIG[host];
      if (config) {
        portalDot.className = `pdot ${config.dotClass}`;
        portalText.textContent = `On ${config.label} portal`;
      } else {
        portalDot.className = "pdot none";
        portalText.textContent = "Not on a Geden portal";
      }
    } catch {
      portalDot.className = "pdot none";
      portalText.textContent = "Not on a Geden portal";
    }
  };

  openErpBtn.addEventListener('click', () => chrome.tabs.create({ url: PORTALS.erp }));
  openGmsBtn.addEventListener('click', () => chrome.tabs.create({ url: PORTALS.gms }));

  // ===== Autofill / login routing =====
  const sendAutofill = (tabId, data) => {
    chrome.tabs.sendMessage(tabId, { action: "autofill", data }, (response) => {
      if (chrome.runtime.lastError) {
        // Content script not injected yet — inject then retry once.
        chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] }, () => {
          chrome.tabs.sendMessage(tabId, { action: "autofill", data }, (res) => {
            if (res && res.success) showToast("Switched and logging in!");
          });
        });
      } else if (response && response.success) {
        showToast("Switched and logging in!");
      } else if (response && response.message) {
        showToast(response.message);
      }
    });
  };

  const triggerAutofill = async (username, password, token) => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.url) {
      showToast("No active browser tab found.");
      return;
    }

    let urlObj;
    try { urlObj = new URL(tab.url); } catch { showToast("Unsupported page."); return; }

    const config = PORTAL_CONFIG[urlObj.host];
    if (!config) {
      showToast("Open a Geden Lines tab first!");
      return;
    }

    const path = urlObj.pathname.toLowerCase();
    const onLoginPage = path.startsWith(config.loginPath.toLowerCase());

    if (onLoginPage) {
      sendAutofill(tab.id, { username, password, token });
    } else {
      // Logged in elsewhere — log out first, then the content script auto-fills on the login page.
      const loginUrl = urlObj.origin + config.loginPath;
      const logoutUrl = urlObj.origin + config.logoutPath;
      chrome.storage.local.set({
        pendingLogin: { username, password, token, loginUrl }
      }, () => {
        showToast("Logging out current account...");
        chrome.tabs.update(tab.id, { url: logoutUrl });
      });
    }
  };

  // ===== DOCX parsing (pure JSZip, no server) =====
  const parseVesselTokenLocal = async (arrayBuffer) => {
    const zip = await JSZip.loadAsync(arrayBuffer);
    const docXmlText = await zip.file("word/document.xml").async("text");
    const xmlDoc = new DOMParser().parseFromString(docXmlText, "text/xml");
    const tNodes = xmlDoc.getElementsByTagNameNS("*", "t");
    let fullText = "";
    for (let i = 0; i < tNodes.length; i++) fullText += tNodes[i].textContent + " ";

    // Token follows an "... is : XXXXXXX" pattern; allow some length/case flexibility.
    let token = "";
    const match = fullText.match(/is\s*:\s*([A-Za-z0-9]{5,12})/i);
    if (match) token = match[1];

    return { username: appState.settings.vesselUsername || "ASPRING", token };
  };

  const parseCrewTokensLocal = async (arrayBuffer) => {
    const zip = await JSZip.loadAsync(arrayBuffer);
    const docXmlText = await zip.file("word/document.xml").async("text");
    const xmlDoc = new DOMParser().parseFromString(docXmlText, "text/xml");
    const rows = xmlDoc.getElementsByTagNameNS("*", "tr");

    const getCellText = (cell) => {
      const tTags = cell.getElementsByTagNameNS("*", "t");
      let str = "";
      for (let j = 0; j < tTags.length; j++) str += tTags[j].textContent;
      return str.trim();
    };

    const crewList = [];
    for (let i = 1; i < rows.length; i++) { // skip header row
      const cells = rows[i].getElementsByTagNameNS("*", "tc");
      if (cells.length >= 5) {
        const rank = getCellText(cells[0]);
        const name = getCellText(cells[1]);
        const email = getCellText(cells[2]);
        const password = getCellText(cells[3]);
        const token = getCellText(cells[4]);
        if (email && token) crewList.push({ rank, name, email, password, token });
      }
    }
    return crewList;
  };

  // Parse an ArrayBuffer into state for the given type.
  const processBuffer = async (buffer, type, filename) => {
    if (type === "vessel") {
      const vessel = await parseVesselTokenLocal(buffer);
      appState.vessel = vessel;
      appState.loadedFiles.vessel = filename;
      appState.loadedAt.vessel = Date.now();
      if (vessel.token) {
        fileState.vessel = "loaded";
        showToast("Vessel token loaded successfully!");
      } else {
        fileState.vessel = "error";
        showToast("No token found in the vessel file.");
      }
    } else {
      const crewList = await parseCrewTokensLocal(buffer);
      appState.crew = crewList;
      appState.loadedFiles.crew = filename;
      appState.loadedAt.crew = Date.now();
      if (crewList.length > 0) {
        fileState.crew = "loaded";
        showToast(`Loaded ${crewList.length} crew accounts!`);
      } else {
        fileState.crew = "error";
        showToast("No crew rows found in the file.");
      }
    }
    await saveStateToStorage();
    updateUI();
  };

  // ===== File handle permission helper =====
  const ensureReadPermission = async (handle) => {
    const opts = { mode: "read" };
    if (await handle.queryPermission(opts) === "granted") return true;
    if (await handle.requestPermission(opts) === "granted") return true;
    return false;
  };

  // Load from a FileSystemFileHandle and remember it for future reloads.
  const loadFromHandle = async (handle, type) => {
    try {
      if (!(await ensureReadPermission(handle))) {
        showToast("Permission to read the file was denied.");
        return;
      }
      const file = await handle.getFile();
      const buffer = await file.arrayBuffer();
      await processBuffer(buffer, type, file.name);
      await idbSetHandle(type === "vessel" ? "vesselHandle" : "crewHandle", handle);
    } catch (err) {
      console.error("Error reading file handle:", err);
      fileState[type] = "error";
      updateUI();
      showToast("Error parsing Word document. Please ensure it's valid.");
    }
  };

  // Fallback: load from a plain File (no handle → cannot be reloaded later).
  const loadFromFile = async (file, type) => {
    try {
      const buffer = await file.arrayBuffer();
      await processBuffer(buffer, type, file.name);
    } catch (err) {
      console.error("Error parsing DOCX file:", err);
      fileState[type] = "error";
      updateUI();
      showToast("Error parsing Word document. Please ensure it's valid.");
    }
  };

  // ===== Reload from previously selected files =====
  const reloadFiles = async () => {
    const vesselHandle = await idbGetHandle("vesselHandle").catch(() => null);
    const crewHandle = await idbGetHandle("crewHandle").catch(() => null);

    if (!vesselHandle && !crewHandle) {
      showToast("No files selected yet — pick them in the Files tab first.");
      return;
    }

    reloadBtn.classList.add('spinning');
    reloadBtn.disabled = true;

    let reloaded = 0;
    try {
      if (vesselHandle && await ensureReadPermission(vesselHandle)) {
        const file = await vesselHandle.getFile();
        appState.vessel = await parseVesselTokenLocal(await file.arrayBuffer());
        appState.loadedFiles.vessel = file.name;
        appState.loadedAt.vessel = Date.now();
        fileState.vessel = appState.vessel.token ? "loaded" : "error";
        reloaded++;
      }
      if (crewHandle && await ensureReadPermission(crewHandle)) {
        const file = await crewHandle.getFile();
        appState.crew = await parseCrewTokensLocal(await file.arrayBuffer());
        appState.loadedFiles.crew = file.name;
        appState.loadedAt.crew = Date.now();
        fileState.crew = appState.crew.length ? "loaded" : "error";
        reloaded++;
      }
      await saveStateToStorage();
      updateUI();
      showToast(reloaded > 0 ? "Tokens refreshed from file!" : "Could not access the saved files.");
    } catch (err) {
      console.error("Reload failed:", err);
      showToast("Reload failed — the file may have moved or been renamed.");
    } finally {
      reloadBtn.classList.remove('spinning');
      reloadBtn.disabled = false;
    }
  };

  reloadBtn.addEventListener('click', reloadFiles);

  // ===== Search =====
  searchBar.addEventListener('input', (e) => renderAccounts(e.target.value));

  // ===== Settings save =====
  saveSettingsBtn.addEventListener('click', async () => {
    appState.settings.vesselUsername = vesselUsernameInput.value.trim();
    appState.settings.vesselPassword = vesselPasswordInput.value.trim();
    if (appState.vessel) {
      appState.vessel.username = appState.settings.vesselUsername || "ASPRING";
    }
    await saveStateToStorage();
    showToast("Settings saved successfully");
    updateUI();
  });

  // ===== Dropzones (picker + drag/drop, both capture a reusable handle when possible) =====
  const pickFile = async () => {
    const [handle] = await window.showOpenFilePicker({
      multiple: false,
      types: [{
        description: "Word Document",
        accept: { "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [".docx"] }
      }]
    });
    return handle;
  };

  const setupDropzone = (dropzone, input, type) => {
    dropzone.addEventListener('click', async () => {
      // Prefer the File System Access picker so the selection can be reloaded later.
      if (window.showOpenFilePicker) {
        try {
          const handle = await pickFile();
          if (handle) await loadFromHandle(handle, type);
        } catch (err) {
          if (err && err.name !== "AbortError") {
            console.error(err);
            input.click(); // fall back to classic input
          }
        }
      } else {
        input.click();
      }
    });

    dropzone.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropzone.classList.add('dragover');
    });

    dropzone.addEventListener('dragleave', () => dropzone.classList.remove('dragover'));

    dropzone.addEventListener('drop', async (e) => {
      e.preventDefault();
      dropzone.classList.remove('dragover');
      const item = e.dataTransfer.items && e.dataTransfer.items[0];

      // Try to grab a reusable handle from the drop (Chrome supports this).
      if (item && item.getAsFileSystemHandle) {
        try {
          const handle = await item.getAsFileSystemHandle();
          if (handle && handle.kind === "file" && handle.name.endsWith('.docx')) {
            await loadFromHandle(handle, type);
            return;
          }
        } catch (_) { /* fall through to File path */ }
      }

      const files = e.dataTransfer.files;
      if (files.length > 0 && files[0].name.endsWith('.docx')) {
        loadFromFile(files[0], type);
      } else {
        showToast("Please drop a Word document (.docx) file.");
      }
    });

    input.addEventListener('change', (e) => {
      const files = e.target.files;
      if (files.length > 0) loadFromFile(files[0], type);
    });
  };

  setupDropzone(vesselDropzone, vesselFileInput, "vessel");
  setupDropzone(crewDropzone, crewFileInput, "crew");

  // ===== Startup =====
  await loadStateFromStorage();
  // Seed badge state from whatever was previously loaded.
  fileState.vessel = appState.loadedFiles.vessel ? "loaded" : "missing";
  fileState.crew = appState.loadedFiles.crew ? "loaded" : "missing";
  updateUI();
  updatePortalStatus();
});
