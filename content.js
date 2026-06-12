// ERP Account Switcher — Content Script
// Handles automated login-form filling/submission on the Geden Lines and
// Advantage Tankers (gms / app .gedenlines.com) portals.

// Login page paths for the supported portals (lower-case, prefix match).
const LOGIN_PATHS = ["/account/logon", "/login"];

const isLoginPage = (pathname) => {
  const p = (pathname || "").toLowerCase();
  return LOGIN_PATHS.some((lp) => p === lp || p.startsWith(lp));
};

// Fill the login form and trigger submission.
const executeAutofill = (username, password, token) => {
  const setInputValue = (input, value) => {
    if (!input) return false;
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  };

  const usernameInput = document.querySelector(
    'input[name="username"], input[name="email"], #username, #email, input[type="text"]'
  );
  const passwordInput = document.querySelector(
    'input[type="password"], input[name="password"], #password'
  );

  // The token field is a second text-like input (named token, or the next text box).
  let tokenInput = document.querySelector('input[name="token"], #token, input[name="Token"]');
  if (!tokenInput || tokenInput === usernameInput) {
    const textInputs = Array.from(
      document.querySelectorAll('input:not([type="password"]):not([type="hidden"]):not([type="checkbox"]):not([type="radio"]):not([type="submit"])')
    );
    if (textInputs.length > 1) tokenInput = textInputs[1];
  }

  if (usernameInput) setInputValue(usernameInput, username);
  if (passwordInput && password) setInputValue(passwordInput, password);

  let filledToken = false;
  if (tokenInput && tokenInput !== usernameInput && token) {
    filledToken = setInputValue(tokenInput, token);
  }

  // Consider it a success if we at least filled the username (token portals) or password.
  const success = !!(usernameInput || passwordInput);

  if (success) {
    setTimeout(() => {
      const loginBtn = document.querySelector('button[type="submit"], input[type="submit"], .btn-login');
      const form = (usernameInput || passwordInput)?.closest('form');
      if (loginBtn) {
        loginBtn.click();
      } else if (form) {
        form.submit();
      } else {
        const anyBtn = document.querySelector('button');
        if (anyBtn) anyBtn.click();
      }
    }, 300);
    return { success: true, message: filledToken ? "Credentials filled and login triggered." : "Credentials filled." };
  }
  return { success: false, message: "Could not locate the login inputs on this page." };
};

// On every page load: if there's a pending login, fill it (on the login page)
// or, if we just logged out and landed elsewhere, hop to the login page once.
const checkPendingLogin = () => {
  chrome.storage.local.get(['pendingLogin'], (result) => {
    const pending = result.pendingLogin;
    if (!pending) return;

    if (isLoginPage(window.location.pathname)) {
      const { username, password, token } = pending;
      // Clear immediately to prevent loops.
      chrome.storage.local.remove(['pendingLogin'], () => {
        setTimeout(() => executeAutofill(username, password, token), 150);
      });
    } else if (pending.loginUrl && !pending.redirected) {
      // Logged out but the server didn't drop us on the login page — go there once.
      chrome.storage.local.set({ pendingLogin: { ...pending, redirected: true } }, () => {
        window.location.href = pending.loginUrl;
      });
    } else {
      // Already redirected once and still not a login page — give up to avoid loops.
      chrome.storage.local.remove(['pendingLogin']);
    }
  });
};

// Direct messages from the popup (used when already on the login page).
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "autofill") {
    const { username, password, token } = message.data;
    sendResponse(executeAutofill(username, password, token));
  }
  return true;
});

checkPendingLogin();
