// ===============================
// RESET PASSWORD SYSTEM
// ===============================

const newPasswordInput = document.getElementById('newPassword');
const confirmPasswordInput = document.getElementById('confirmPassword');
const toggleNew = document.getElementById('toggleNew');
const toggleConfirm = document.getElementById('toggleConfirm');
const resetBtn = document.getElementById('resetBtn');

function buildAuthUrl(path) {
    if (window.ByoseAuthApiOrigin && typeof window.ByoseAuthApiOrigin.buildAuthApiUrl === 'function') {
        return window.ByoseAuthApiOrigin.buildAuthApiUrl(path);
    }
    return `${window.location.origin}/api/${String(path || '').replace(/^\/+/, '')}`;
}

toggleNew.addEventListener('click', () => {
    newPasswordInput.type = newPasswordInput.type === 'password' ? 'text' : 'password';
});

toggleConfirm.addEventListener('click', () => {
    confirmPasswordInput.type = confirmPasswordInput.type === 'password' ? 'text' : 'password';
});

function isStrongPassword(password) {
    const value = String(password || '');
    if (value.length < 8 || value.length > 128) return false;
    return /[a-z]/.test(value) && /[A-Z]/.test(value) && /\d/.test(value);
}

async function updatePassword(identifier, newPassword, resetToken) {
    const response = await fetch(buildAuthUrl('auth/reset-password'), {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json'
        },
        body: JSON.stringify({ identifier, newPassword, resetToken })
    });

    const payload = await response.json().catch(() => null);
    if (!response.ok) {
        return { success: false, message: payload?.message || `Password reset failed with status ${response.status}` };
    }

    return payload || { success: false, message: 'Invalid API response.' };
}

resetBtn.addEventListener('click', async () => {
    const newPassword = newPasswordInput.value;
    const confirmPassword = confirmPasswordInput.value;

    if (!newPassword || !confirmPassword) {
        alert('Fill all fields');
        return;
    }

    if (!isStrongPassword(newPassword)) {
        alert('Password must be 8+ characters with uppercase, lowercase, and a number');
        return;
    }

    if (newPassword !== confirmPassword) {
        alert('Passwords do not match');
        return;
    }

    const identifier = localStorage.getItem('resetIdentifier');
    const resetToken = localStorage.getItem('resetToken');

    if (!identifier || !resetToken) {
        alert('Reset session expired. Start again from forgot password.');
        window.location.href = 'forgot-password.html';
        return;
    }

    resetBtn.innerText = 'Updating...';
    resetBtn.disabled = true;

    try {
        const data = await updatePassword(identifier, newPassword, resetToken);

        if (data.success) {
            localStorage.removeItem('resetMethod');
            localStorage.removeItem('resetIdentifier');
            localStorage.removeItem('resetToken');
            alert('Password updated successfully!');
            window.location.href = 'login.html';
        } else {
            alert(data.message || 'Failed to update password');
        }
    } catch (err) {
        console.error(err);
        alert('Unable to update the password right now.');
    }

    resetBtn.innerText = 'Reset Password';
    resetBtn.disabled = false;
});
