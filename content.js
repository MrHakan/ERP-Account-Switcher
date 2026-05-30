// Geden Lines Account Switcher Content Script
// Handles automated form injection and submission on Geden Lines portals

// Common function to perform form filling and login trigger
const executeAutofill = (username, password, token) => {
  // Attempt multiple standard selectors for Geden Lines login forms
  const usernameInput = document.querySelector('input[type="text"], input[name="username"], input[name="email"], #username, #email');
  const passwordInput = document.querySelector('input[type="password"], input[name="password"], #password');
  const tokenInput = document.querySelectorAll('input[type="text"], input[name="token"], #token')[1] || document.querySelector('input[name="token"], #token');

  let success = false;

  // Helper to safely set input value and dispatch events for reactivity
  const setInputValue = (input, value) => {
    if (!input) return false;
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  };

  if (usernameInput) setInputValue(usernameInput, username);
  if (passwordInput && password) setInputValue(passwordInput, password);
  
  // Find the token field carefully (if there are multiple text fields)
  let actualTokenInput = tokenInput;
  if (!actualTokenInput || actualTokenInput === usernameInput) {
    // Find the second text-like input if token input wasn't resolved correctly
    const textInputs = Array.from(document.querySelectorAll('input:not([type="password"]):not([type="hidden"])'));
    if (textInputs.length > 1) {
      actualTokenInput = textInputs[1];
    }
  }
  
  if (actualTokenInput) {
    setInputValue(actualTokenInput, token);
    success = true;
  }

  if (success) {
    // Small delay then submit
    setTimeout(() => {
      const loginBtn = document.querySelector('button[type="submit"], input[type="submit"], .btn-login, button');
      if (loginBtn) {
        loginBtn.click();
      } else {
        const form = usernameInput.closest('form');
        if (form) form.submit();
      }
    }, 300);
    return { success: true, message: "Credentials filled and login triggered." };
  } else {
    return { success: false, message: "Could not locate the token inputs on this page." };
  }
};

// Check for pending auto-login on startup
const checkPendingLogin = () => {
  const isLogonPage = window.location.pathname.toLowerCase().includes('/account/logon');
  if (isLogonPage) {
    chrome.storage.local.get(['pendingLogin'], (result) => {
      if (result.pendingLogin) {
        const { username, password, token } = result.pendingLogin;
        // Clear pending login immediately to prevent infinite loops
        chrome.storage.local.remove(['pendingLogin'], () => {
          console.log("Found pending Geden login, executing auto-login sequence...");
          // Execute with a tiny delay to ensure front-end framework forms are fully bound
          setTimeout(() => {
            executeAutofill(username, password, token);
          }, 150);
        });
      }
    });
  }
};

// Listen for direct messages from the popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "autofill") {
    const { username, password, token } = message.data;
    const result = executeAutofill(username, password, token);
    sendResponse(result);
  }
  return true;
});

// Run check on load
checkPendingLogin();
