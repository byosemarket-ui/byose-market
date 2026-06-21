// ===============================
// OTP VERIFY SYSTEM
// ===============================

const inputs = document.querySelectorAll('.otp-input');
const verifyBtn = document.getElementById('verifyBtn');
const resendBtn = document.getElementById('resendBtn');
const countdownEl = document.getElementById('countdown');

function buildAuthUrl(path) {
    if (window.ByoseAuthApiOrigin && typeof window.ByoseAuthApiOrigin.buildAuthApiUrl === 'function') {
        return window.ByoseAuthApiOrigin.buildAuthApiUrl(path);
    }
    return `${window.location.origin}/api/${String(path || '').replace(/^\/+/, '')}`;
}

inputs.forEach((input, index) => {
    input.addEventListener('input', () => {
        if (input.value.length === 1 && index < inputs.length - 1) {
            inputs[index + 1].focus();
        }
    });

    input.addEventListener('keydown', (e) => {
        if (e.key === 'Backspace' && input.value === '' && index > 0) {
            inputs[index - 1].focus();
        }
    });
});

function getOTP() {
    return Array.from(inputs).map((i) => i.value).join('');
}

let time = 300;

async function verifyResetCode(identifier, otp) {
    const response = await fetch(buildAuthUrl('auth/verify-code'), {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json'
        },
        body: JSON.stringify({ identifier, otp })
    });

    const payload = await response.json().catch(() => null);
    if (!response.ok) {
        return { success: false, message: payload?.message || `Verify request failed with status ${response.status}` };
    }

    return payload || { success: false, message: 'Invalid API response.' };
}

async function resendResetCode(method, identifier) {
    const response = await fetch(buildAuthUrl('auth/forgot-password'), {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json'
        },
        body: JSON.stringify({ method, identifier })
    });

    const payload = await response.json().catch(() => null);
    if (!response.ok) {
        return { success: false, message: payload?.message || `Resend request failed with status ${response.status}` };
    }

    return payload || { success: false, message: 'Invalid API response.' };
}

const timer = setInterval(() => {
    time -= 1;
    countdownEl.innerText = time;

    if (time <= 0) {
        clearInterval(timer);
        countdownEl.innerText = '0';
    }
}, 1000);

verifyBtn.addEventListener('click', async () => {
    const otp = getOTP();

    if (otp.length !== 6) {
        alert('Enter full 6-digit code');
        return;
    }

    verifyBtn.innerText = 'Verifying...';
    verifyBtn.disabled = true;

    const identifier = localStorage.getItem('resetIdentifier');

    try {
        const data = await verifyResetCode(identifier, otp);

        if (data.success && data.resetToken) {
            localStorage.setItem('resetToken', data.resetToken);
            window.location.href = 'reset-password.html';
        } else {
            alert(data.message || 'Invalid or expired code');
        }
    } catch (err) {
        console.error(err);
        alert('Unable to verify the code right now.');
    }

    verifyBtn.innerText = 'Verify Code';
    verifyBtn.disabled = false;
});

resendBtn.addEventListener('click', async () => {
    const method = localStorage.getItem('resetMethod');
    const identifier = localStorage.getItem('resetIdentifier');

    resendBtn.innerText = 'Sending...';

    try {
        const data = await resendResetCode(method, identifier);

        if (data.success) {
            alert('Code resent!');
            time = 300;
        } else {
            alert(data.message || 'Failed to resend code');
        }
    } catch (err) {
        console.error(err);
        alert('Unable to resend the code right now.');
    }

    resendBtn.innerText = 'Resend';
});
