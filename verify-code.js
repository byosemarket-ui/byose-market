// ===============================
// OTP VERIFY SYSTEM (PRO)
// ===============================

const inputs = document.querySelectorAll(".otp-input");
const verifyBtn = document.getElementById("verifyBtn");
const resendBtn = document.getElementById("resendBtn");
const countdownEl = document.getElementById("countdown");
const PRODUCTION_API_ORIGIN = 'https://byosemarket-admin-api.onrender.com';

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
// AUTO MOVE INPUT
// ===============================
inputs.forEach((input, index) => {

    input.addEventListener("input", () => {
        if (input.value.length === 1 && index < inputs.length - 1) {
            inputs[index + 1].focus();
        }
    });

    input.addEventListener("keydown", (e) => {
        if (e.key === "Backspace" && input.value === "" && index > 0) {
            inputs[index - 1].focus();
        }
    });

});

// ===============================
// GET OTP VALUE
// ===============================
function getOTP() {
    return Array.from(inputs).map(i => i.value).join("");
}

// ===============================
// TIMER
// ===============================
let time = 60;

function getStoredResetCode() {
    return localStorage.getItem('resetCode');
}

async function verifyResetCode(method, identifier, otp) {
    const endpoint = window.__BYOSE_VERIFY_CODE_API__ || `${resolveApiOrigin()}/api/auth/verify-code`;

    if (endpoint) {
        const response = await fetch(endpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ method, identifier, otp })
        });

        return response.json();
    }

    return { success: otp === getStoredResetCode() };
}

async function resendResetCode(method, identifier) {
    const endpoint = window.__BYOSE_PASSWORD_RESET_API__ || `${resolveApiOrigin()}/api/auth/forgot-password`;

    if (endpoint) {
        const response = await fetch(endpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ method, identifier })
        });

        return response.json();
    }

    const code = String(Math.floor(100000 + Math.random() * 900000));
    localStorage.setItem('resetCode', code);
    localStorage.setItem('resetIdentifier', identifier || '');
    return { success: true, staticCode: code };
}

const timer = setInterval(() => {
    time--;
    countdownEl.innerText = time;

    if (time <= 0) {
        clearInterval(timer);
        countdownEl.innerText = "0";
    }
}, 1000);


// ===============================
// VERIFY CODE
// ===============================
verifyBtn.addEventListener("click", async () => {

    const otp = getOTP();

    if (otp.length !== 6) {
        alert("Enter full 6-digit code");
        return;
    }

    verifyBtn.innerText = "Verifying...";
    verifyBtn.disabled = true;

    const method = localStorage.getItem("resetMethod");
    const identifier = localStorage.getItem("resetIdentifier");

    try {
        const data = await verifyResetCode(method, identifier, otp);

        if (data.success) {
            window.location.href = "reset-password.html";
        } else {
            alert("Invalid or expired code");
        }

    } catch (err) {
        console.error(err);
        alert("Unable to verify the code right now.");
    }

    verifyBtn.innerText = "Verify Code";
    verifyBtn.disabled = false;
});


// ===============================
// RESEND CODE
// ===============================
resendBtn.addEventListener("click", async () => {

    const method = localStorage.getItem("resetMethod");
    const identifier = localStorage.getItem("resetIdentifier");

    resendBtn.innerText = "Sending...";

    try {
        const data = await resendResetCode(method, identifier);

        if (data.success) {
            if (data.staticCode) {
                alert(`Static hosting mode code: ${data.staticCode}`);
            }
            alert("Code resent!");
            time = 60;
        } else {
            alert("Failed to resend code");
        }

    } catch (err) {
        console.error(err);
        alert("Unable to resend the code right now.");
    }

    resendBtn.innerText = "Resend";
});