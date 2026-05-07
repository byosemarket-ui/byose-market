// ===============================
// FORGOT PASSWORD LOGIC
// ===============================

const methodSelect = document.getElementById('method');
const identifierInput = document.getElementById('identifier');
const inputLabel = document.getElementById('inputLabel');
const sendBtn = document.getElementById('sendCodeBtn');
const PRODUCTION_API_ORIGIN = 'https://byosesemarket4.onrender.com';

function normalizeBase(value) {
    return String(value || '').trim().replace(/\/+$/, '');
}

function isLocalHost(hostname) {
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '0.0.0.0';
}

function shouldUseProductionApi(hostname) {
    return /(^|\.)(github\.io|byosemarket\.com)$/i.test(String(hostname || ''));
}

function resolveApiOrigin() {
    const explicit = normalizeBase(window.BYOSE_API_BASE_URL || window.__BYOSE_API_BASE__ || '');
    if (explicit) {
        return explicit;
    }

    const protocol = String(window.location?.protocol || '').toLowerCase();
    const hostname = String(window.location?.hostname || '').trim();

    if (protocol === 'file:' || isLocalHost(hostname)) {
        return `http://${hostname || 'localhost'}:5000`;
    }

    if (shouldUseProductionApi(hostname)) {
        return PRODUCTION_API_ORIGIN;
    }

    return normalizeBase(window.location?.origin || '');
}

// ===============================
// CHANGE INPUT BASED ON METHOD
// ===============================
methodSelect.addEventListener('change', () => {
    const method = methodSelect.value;

    if (method === 'email') {
        inputLabel.innerText = "Email Address";
        identifierInput.placeholder = "Enter your email";
        identifierInput.type = "email";
    } else {
        inputLabel.innerText = "Phone Number";
        identifierInput.placeholder = "Enter your phone (+250...)";
        identifierInput.type = "tel";
    }
});

// ===============================
// VALIDATION FUNCTIONS
// ===============================
function validateEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function validatePhone(phone) {
    return /^\+2507\d{8}$/.test(phone); // Rwanda format
}

function getStoredUsers() {
    try {
        return JSON.parse(localStorage.getItem('bm_users')) || [];
    } catch (error) {
        return [];
    }
}

function hasMatchingUser(method, identifier) {
    const normalized = method === 'email' ? identifier.toLowerCase() : identifier;
    return getStoredUsers().some((user) => {
        if (method === 'email') {
            return (user.email || '').toLowerCase() === normalized;
        }
        return (user.phone || '') === normalized;
    });
}

function storeResetCode(identifier) {
    const code = String(Math.floor(100000 + Math.random() * 900000));
    localStorage.setItem('resetIdentifier', identifier);
    localStorage.setItem('resetCode', code);
    return code;
}

async function requestResetCode(method, identifier) {
    const endpoint = window.__BYOSE_PASSWORD_RESET_API__ || `${resolveApiOrigin()}/api/auth/forgot-password`;

    if (endpoint) {
        const response = await fetch(endpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Accept: 'application/json'
            },
            body: JSON.stringify({ method, identifier })
        });

        const payload = await response.json().catch(() => null);
        if (!response.ok) {
            return { success: false, message: payload?.message || `Reset-code request failed with status ${response.status}` };
        }

        return payload || { success: false, message: 'Invalid API response.' };
    }

    if (!hasMatchingUser(method, identifier)) {
        return { success: false, message: 'Account not found for that identifier.' };
    }

    const code = storeResetCode(identifier);
    return {
        success: true,
        staticCode: code,
        message: 'Static hosting mode: use the generated code to continue.'
    };
}

// ===============================
// SEND CODE
// ===============================
sendBtn.addEventListener('click', async () => {
    const method = methodSelect.value;
    const identifier = identifierInput.value.trim();

    // validation
    if (!identifier) {
        alert("Please enter your details");
        return;
    }

    if (method === "email" && !validateEmail(identifier)) {
        alert("Invalid email format");
        return;
    }

    if (method === "phone" && !validatePhone(identifier)) {
        alert("Invalid phone format. Use +2507XXXXXXXX");
        return;
    }

    sendBtn.innerText = "Sending...";
    sendBtn.disabled = true;

    try {
        const data = await requestResetCode(method, identifier);

        if (data.success) {

            // Save for next step
            localStorage.setItem("resetMethod", method);
            localStorage.setItem("resetIdentifier", identifier);

            // Go to verify page
            if (data.staticCode) {
                alert(`Static hosting mode code: ${data.staticCode}`);
            }
            window.location.href = "verify-code.html";

        } else {
            alert(data.message || "Failed to send code");
        }

    } catch (error) {
        console.error(error);
        alert("Unable to send reset code right now.");
    }

    sendBtn.innerText = "Send Reset Code";
    sendBtn.disabled = false;
});