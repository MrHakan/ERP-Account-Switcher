// Geden Lines Account Switcher Popup Logic

document.addEventListener('DOMContentLoaded', async () => {
  // UI Selectors
  const tabs = document.querySelectorAll('.tab-btn');
  const panes = document.querySelectorAll('.content-pane');
  const searchBar = document.getElementById('search-bar');
  const vesselAccountContainer = document.getElementById('vessel-account-container');
  const vesselSection = document.getElementById('vessel-section');
  const crewListContainer = document.getElementById('crew-list-container');
  
  // File inputs and Dropzones
  const vesselDropzone = document.getElementById('vessel-dropzone');
  const crewDropzone = document.getElementById('crew-dropzone');
  const vesselFileInput = document.getElementById('vessel-file-input');
  const crewFileInput = document.getElementById('crew-file-input');
  
  const vesselFilename = document.getElementById('vessel-filename');
  const vesselFilestatus = document.getElementById('vessel-filestatus');
  const crewFilename = document.getElementById('crew-filename');
  const crewFilestatus = document.getElementById('crew-filestatus');
  
  // Settings selectors
  const vesselUsernameInput = document.getElementById('vessel-username-input');
  const vesselPasswordLabel = document.getElementById('vessel-password-label');
  const vesselPasswordInput = document.getElementById('vessel-password-input');
  const autodetectToggle = document.getElementById('autodetect-toggle');
  const folderPathInput = document.getElementById('folder-path-input');
  const folderPathGroup = document.getElementById('folder-path-group');
  const saveSettingsBtn = document.getElementById('save-settings-btn');
  
  // Companion Status selectors
  const companionStatusDot = document.getElementById('companion-status-dot');
  const companionStatusText = document.getElementById('companion-status-text');

  // Application State
  let appState = {
    vessel: null, // { username: "ASPRING", token: "XXXXXXX" }
    crew: [], // Array of { rank, name, email, password, token }
    settings: {
      vesselUsername: "ASPRING",
      vesselPassword: "",
      autoDetect: false,
      folderPath: ""
    },
    loadedFiles: {
      vessel: "",
      crew: ""
    }
  };

  // 1. Navigation Event Handling
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('active'));
      panes.forEach(p => p.classList.remove('active'));
      
      tab.classList.add('active');
      const targetPane = document.getElementById(tab.dataset.tab);
      if (targetPane) targetPane.classList.add('active');
    });
  });

  // 2. Local Storage Sync
  const loadStateFromStorage = async () => {
    return new Promise(resolve => {
      chrome.storage.local.get(['vessel', 'crew', 'settings', 'loadedFiles'], (result) => {
        if (result.vessel) appState.vessel = result.vessel;
        if (result.crew) appState.crew = result.crew;
        if (result.settings) appState.settings = { ...appState.settings, ...result.settings };
        if (result.loadedFiles) appState.loadedFiles = { ...appState.loadedFiles, ...result.loadedFiles };
        resolve();
      });
    });
  };

  const saveStateToStorage = async () => {
    return new Promise(resolve => {
      chrome.storage.local.set({
        vessel: appState.vessel,
        crew: appState.crew,
        settings: appState.settings,
        loadedFiles: appState.loadedFiles
      }, () => resolve());
    });
  };

  // Show dynamic toast notifications
  const showToast = (message) => {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 2000);
  };

  // 3. UI Redraw functions
  const updateUI = () => {
    // Redraw File Status Badges
    if (appState.loadedFiles.vessel) {
      vesselFilename.textContent = appState.loadedFiles.vessel;
      vesselFilestatus.textContent = "Loaded";
      vesselFilestatus.className = "status-badge loaded";
    } else {
      vesselFilename.textContent = "vessel-token.docx";
      vesselFilestatus.textContent = "Missing";
      vesselFilestatus.className = "status-badge missing";
    }

    if (appState.loadedFiles.crew) {
      crewFilename.textContent = appState.loadedFiles.crew;
      crewFilestatus.textContent = "Loaded";
      crewFilestatus.className = "status-badge loaded";
    } else {
      crewFilename.textContent = "crew-tokens.docx";
      crewFilestatus.textContent = "Missing";
      crewFilestatus.className = "status-badge missing";
    }

    // Load inputs in Settings
    vesselUsernameInput.value = appState.settings.vesselUsername || "";
    vesselPasswordInput.value = appState.settings.vesselPassword || "";
    vesselPasswordLabel.textContent = `Vessel Password (${appState.settings.vesselUsername || 'ASPRING'})`;
    autodetectToggle.checked = appState.settings.autoDetect || false;
    folderPathInput.value = appState.settings.folderPath || "";
    
    if (appState.settings.autoDetect) {
      folderPathGroup.style.display = "block";
    } else {
      folderPathGroup.style.display = "none";
    }

    // Redraw Account lists
    renderAccounts();
  };

  // Filter and display accounts in the UI
  const renderAccounts = (filter = "") => {
    vesselAccountContainer.innerHTML = "";
    crewListContainer.innerHTML = "";
    const cleanFilter = filter.toLowerCase().trim();

    // 1. Vessel section
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
              <span class="account-name">${vName}</span>
              <span class="account-rank-badge vessel-badge">Vessel</span>
            </div>
            <span class="account-email">User: ${vEmail} | Token: ${appState.vessel.token}</span>
          </div>
          <div class="action-indicator">🔑</div>
        `;
        card.addEventListener('click', () => triggerAutofill(appState.vessel.username, appState.settings.vesselPassword, appState.vessel.token));
        vesselAccountContainer.appendChild(card);
      }
    } else {
      vesselSection.style.display = "none";
    }

    // 2. Crew list
    if (appState.crew && appState.crew.length > 0) {
      const filteredCrew = appState.crew.filter(c => {
        if (!cleanFilter) return true;
        return c.name.toLowerCase().includes(cleanFilter) || 
               c.rank.toLowerCase().includes(cleanFilter) || 
               c.email.toLowerCase().includes(cleanFilter);
      });

      if (filteredCrew.length > 0) {
        filteredCrew.forEach(c => {
          const card = document.createElement('div');
          card.className = "account-card";
          card.innerHTML = `
            <div class="account-info">
              <div class="account-title-row">
                <span class="account-name">${c.name}</span>
                <span class="account-rank-badge">${c.rank}</span>
              </div>
              <span class="account-email">${c.email} | Token: ${c.token}</span>
            </div>
            <div class="action-indicator">➜</div>
          `;
          card.addEventListener('click', () => triggerAutofill(c.email, c.password, c.token));
          crewListContainer.appendChild(card);
        });
      } else {
        crewListContainer.innerHTML = `<div class="empty-state">No matching accounts found for "${filter}"</div>`;
      }
    } else {
      crewListContainer.innerHTML = `
        <div class="empty-state">
          <span class="empty-state-icon">📂</span>
          No crew data loaded.<br>Use auto-detection or upload token files in the Files tab.
        </div>
      `;
    }
  };

  // Trigger autofill action via background script
  const triggerAutofill = async (username, password, token) => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) {
      showToast("No active browser tab found.");
      return;
    }

    if (!tab.url.includes("gedenlines.com")) {
      showToast("Navigate to a gedenlines.com portal first!");
      return;
    }

    const urlLower = tab.url.toLowerCase();
    const isLogonPage = urlLower.includes('/account/logon');

    if (isLogonPage) {
      // Direct form autofill injection
      chrome.tabs.sendMessage(tab.id, {
        action: "autofill",
        data: { username, password, token }
      }, (response) => {
        if (chrome.runtime.lastError) {
          // Content script might not be injected yet
          chrome.scripting.executeScript({
            target: { tabId: tab.id },
            files: ["content.js"]
          }, () => {
            chrome.tabs.sendMessage(tab.id, {
              action: "autofill",
              data: { username, password, token }
            }, (res) => {
              if (res && res.success) {
                showToast("Switched and Logging in!");
              }
            });
          });
        } else if (response && response.success) {
          showToast("Switched and Logging in!");
        }
      });
    } else {
      // User is logged in on another dashboard. Redirect to /Account/Logout first
      try {
        const urlObj = new URL(tab.url);
        const origin = urlObj.origin;
        const logoffUrl = `${origin}/Account/Logout`;

        chrome.storage.local.set({
          pendingLogin: { username, password, token }
        }, () => {
          showToast("Logging out current account...");
          chrome.tabs.update(tab.id, { url: logoffUrl });
        });
      } catch (err) {
        showToast("Error executing logoff redirect.");
      }
    }
  };

  // 4. Companion Server Check
  const checkCompanionStatus = async () => {
    if (!appState.settings.autoDetect) {
      companionStatusDot.className = "dot offline";
      companionStatusText.textContent = "Auto Detect Disabled";
      return false;
    }

    try {
      const folderPath = encodeURIComponent(appState.settings.folderPath);
      const vesselUsername = encodeURIComponent(appState.settings.vesselUsername || "ASPRING");
      const response = await fetch(`http://localhost:4848/api/detect?path=${folderPath}&username=${vesselUsername}`);
      if (response.ok) {
        const data = await response.json();
        companionStatusDot.className = "dot online";
        companionStatusText.textContent = "Companion Synced";
        
        // Sync detected files to state
        if (data.vessel) {
          appState.vessel = data.vessel;
          appState.loadedFiles.vessel = data.vesselFile;
        }
        if (data.crew) {
          appState.crew = data.crew;
          appState.loadedFiles.crew = data.crewFile;
        }
        
        await saveStateToStorage();
        updateUI();
        return true;
      }
    } catch (e) {
      // Companion server is not running
    }
    
    companionStatusDot.className = "dot offline";
    companionStatusText.textContent = "Local Server Offline";
    return false;
  };

  // 5. In-Browser OpenXML DOCX parsing using pure JSZip
  const parseVesselTokenLocal = async (arrayBuffer) => {
    const zip = await JSZip.loadAsync(arrayBuffer);
    const docXmlText = await zip.file("word/document.xml").async("text");
    
    // Simple regex search for token in text elements
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(docXmlText, "text/xml");
    const tNodes = xmlDoc.getElementsByTagNameNS("*", "t");
    let fullText = "";
    for (let i = 0; i < tNodes.length; i++) {
      fullText += tNodes[i].textContent + " ";
    }
    
    let token = "";
    const match = fullText.match(/is\s*:\s*([A-Z0-9]{7})/);
    if (match) {
      token = match[1];
    }
    
    return {
      username: appState.settings.vesselUsername || "ASPRING",
      token: token
    };
  };

  const parseCrewTokensLocal = async (arrayBuffer) => {
    const zip = await JSZip.loadAsync(arrayBuffer);
    const docXmlText = await zip.file("word/document.xml").async("text");
    
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(docXmlText, "text/xml");
    const rows = xmlDoc.getElementsByTagNameNS("*", "tr");
    
    const crewList = [];
    
    // Skip row 0 (headers)
    for (let i = 1; i < rows.length; i++) {
      const cells = rows[i].getElementsByTagNameNS("*", "tc");
      if (cells.length >= 5) {
        const getCellText = (cell) => {
          const tTags = cell.getElementsByTagNameNS("*", "t");
          let str = "";
          for (let j = 0; j < tTags.length; j++) {
            str += tTags[j].textContent;
          }
          return str.trim();
        };

        const rank = getCellText(cells[0]);
        const name = getCellText(cells[1]);
        const email = getCellText(cells[2]);
        const password = getCellText(cells[3]);
        const token = getCellText(cells[4]);

        if (email && token) {
          crewList.push({ rank, name, email, password, token });
        }
      }
    }
    return crewList;
  };

  // Local file picker uploads
  const handleLocalUpload = async (file, type) => {
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const buffer = e.target.result;
        if (type === "vessel") {
          const vesselData = await parseVesselTokenLocal(buffer);
          appState.vessel = vesselData;
          appState.loadedFiles.vessel = file.name;
          showToast("Vessel token loaded successfully!");
        } else {
          const crewList = await parseCrewTokensLocal(buffer);
          appState.crew = crewList;
          appState.loadedFiles.crew = file.name;
          showToast(`Loaded ${crewList.length} crew accounts!`);
        }
        await saveStateToStorage();
        updateUI();
      } catch (err) {
        console.error("Error parsing DOCX file:", err);
        showToast("Error parsing Word document. Please ensure it's valid.");
      }
    };
    reader.readAsArrayBuffer(file);
  };

  // 6. UI Interaction Setup
  
  // Search bar input
  searchBar.addEventListener('input', (e) => {
    renderAccounts(e.target.value);
  });

  // Settings: Autodetect Toggle display sync
  autodetectToggle.addEventListener('change', (e) => {
    if (e.target.checked) {
      folderPathGroup.style.display = "block";
    } else {
      folderPathGroup.style.display = "none";
    }
  });

  // Settings: Save Settings Trigger
  saveSettingsBtn.addEventListener('click', async () => {
    appState.settings.vesselUsername = vesselUsernameInput.value.trim();
    appState.settings.vesselPassword = vesselPasswordInput.value.trim();
    appState.settings.autoDetect = autodetectToggle.checked;
    appState.settings.folderPath = folderPathInput.value.trim();
    
    // Dynamically update existing loaded vessel details with the new username if loaded
    if (appState.vessel) {
      appState.vessel.username = appState.settings.vesselUsername || "ASPRING";
    }

    await saveStateToStorage();
    showToast("Settings Saved Successfully");
    
    // Instantly try connecting to companion
    checkCompanionStatus();
    updateUI();
  });

  // Files: Drag & Drop Event bindings
  const setupDropzone = (dropzone, input, type) => {
    dropzone.addEventListener('click', () => input.click());
    
    dropzone.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropzone.classList.add('dragover');
    });

    dropzone.addEventListener('dragleave', () => {
      dropzone.classList.remove('dragover');
    });

    dropzone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropzone.classList.remove('dragover');
      const files = e.dataTransfer.files;
      if (files.length > 0 && files[0].name.endsWith('.docx')) {
        handleLocalUpload(files[0], type);
      } else {
        showToast("Please drop a Word document (.docx) file.");
      }
    });

    input.addEventListener('change', (e) => {
      const files = e.target.files;
      if (files.length > 0) {
        handleLocalUpload(files[0], type);
      }
    });
  };

  setupDropzone(vesselDropzone, vesselFileInput, "vessel");
  setupDropzone(crewDropzone, crewFileInput, "crew");

  // 7. Initial Startup Execution
  await loadStateFromStorage();
  updateUI();
  
  // Periodic sync check
  checkCompanionStatus();
  setInterval(checkCompanionStatus, 8000);
});
