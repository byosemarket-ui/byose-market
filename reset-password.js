// ===============================
// RESET PASSWORD SYSTEM (PRO)
// ===============================

const newPasswordInput = document.getElementById("newPassword");
const confirmPasswordInput = document.getElementById("confirmPassword");

const toggleNew = document.getElementById("toggleNew");
const toggleConfirm = document.getElementById("toggleConfirm");

const resetBtn = document.getElementById("resetBtn");
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
// SHOW / HIDE PASSWORD
// ===============================
toggleNew.addEventListener("click", () => {
    const type = newPasswordInput.type === "password" ? "text" : "password";
    newPasswordInput.type = type;
});

toggleConfirm.addEventListener("click", () => {
    const type = confirmPasswordInput.type === "password" ? "text" : "password";
    confirmPasswordInput.type = type;
});

// ===============================
// VALIDATION
// ===============================
function validatePassword(password) {
    return password.length >= 4;
}

function getStoredUsers() {
    try {
        return JSON.parse(localStorage.getItem('bm_users')) || [];
    } catch (error) {
        return [];
    }
}

function saveStoredUsers(users) {
    localStorage.setItem('bm_users', JSON.stringify(users));
    localStorage.setItem('byose_market_users', JSON.stringify(users));
}

async function updatePassword(method, identifier, newPassword) {
    const endpoint = window.__BYOSE_RESET_PASSWORD_API__ || `${resolveApiOrigin()}/api/auth/reset-password`;

    if (endpoint) {
        const response = await fetch(endpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Accept: 'application/json'
            },
            body: JSON.stringify({ method, identifier, newPassword })
        });

        const payload = await response.json().catch(() => null);
        if (!response.ok) {
            return { success: false, message: payload?.message || `Password reset failed with status ${response.status}` };
        }

        return payload || { success: false, message: 'Invalid API response.' };
    }

    const users = getStoredUsers();
    const index = users.findIndex((user) => {
        if (method === 'email') {
            return (user.email || '').toLowerCase() === String(identifier || '').toLowerCase();
        }
        return (user.phone || '') === identifier;
    });

    if (index === -1) {
        return { success: false, message: 'Account not found.' };
    }

    users[index].password = newPassword;
    saveStoredUsers(users);

    try {
        const currentUser = JSON.parse(localStorage.getItem('bm_current_user') || 'null');
        if (currentUser && users[index].id === currentUser.id) {
            localStorage.setItem('bm_current_user', JSON.stringify(users[index]));
            localStorage.setItem('bm_user', JSON.stringify(users[index]));
        }
    } catch (error) {
        console.error(error);
    }

    localStorage.removeItem('resetCode');
    return { success: true };
}

// ===============================
// RESET PASSWORD
// ===============================
resetBtn.addEventListener("click", async () => {

    const newPassword = newPasswordInput.value.trim();
    const confirmPassword = confirmPasswordInput.value.trim();

    if (!newPassword || !confirmPassword) {
        alert("Fill all fields");
        return;
    }

    if (!validatePassword(newPassword)) {
        alert("Password must be at least 4 characters");
        return;
    }

    if (newPassword !== confirmPassword) {
        alert("Passwords do not match");
        return;
    }

    resetBtn.innerText = "Updating...";
    resetBtn.disabled = true;

    const method = localStorage.getItem("resetMethod");
    const identifier = localStorage.getItem("resetIdentifier");

    try {
        const data = await updatePassword(method, identifier, newPassword);

        if (data.success) {

            alert("Password updated successfully!");

            // clear storage
            localStorage.removeItem("resetMethod");
            localStorage.removeItem("resetIdentifier");

            // redirect to login
            window.location.href = "login.html";

        } else {
            alert("Failed to update password");
        }

    } catch (err) {
        console.error(err);
        alert("Unable to update the password right now.");
    }

    resetBtn.innerText = "Reset Password";
    resetBtn.disabled = false;

});