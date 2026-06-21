// ===============================
// FORGOT PASSWORD LOGIC
// ===============================

const methodSelect = document.getElementById('method');
const identifierInput = document.getElementById('identifier');
const inputLabel = document.getElementById('inputLabel');
const sendBtn = document.getElementById('sendCodeBtn');

function buildAuthUrl(path) {
    if (window.ByoseAuthApiOrigin && typeof window.ByoseAuthApiOrigin.buildAuthApiUrl === 'function') {
        return window.ByoseAuthApiOrigin.buildAuthApiUrl(path);
    }
    return `${window.location.origin}/api/${String(path || '').replace(/^\/+/, '')}`;
}

// ===============================
// CHANGE INPUT BASED ON METHOD
// ===============================
methodSelect.addEventListener('change', () => {
    const method = methodSelect.value;

    if (method === 'email') {
        inputLabel.innerText = 'Email Address';
        identifierInput.placeholder = 'Enter your email';
        identifierInput.type = 'email';
    } else {
        inputLabel.innerText = 'Phone Number';
        identifierInput.placeholder = 'Enter your phone (+250...)';
        identifierInput.type = 'tel';
    }
});

function validateEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function validatePhone(phone) {
    const cleaned = String(phone || '').replace(/[\s-]/g, '');
    return /^(\+250|250|0)?7\d{8}$/.test(cleaned);
}

async function requestResetCode(method, identifier) {
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
        return { success: false, message: payload?.message || `Reset-code request failed with status ${response.status}` };
    }

    return payload || { success: false, message: 'Invalid API response.' };
}

sendBtn.addEventListener('click', async () => {
    const method = methodSelect.value;
    const identifier = identifierInput.value.trim();

    if (!identifier) {
        alert('Please enter your details');
        return;
    }

    if (method === 'email' && !validateEmail(identifier)) {
        alert('Invalid email format');
        return;
    }

    if (method === 'phone' && !validatePhone(identifier)) {
        alert('Invalid phone format. Use +2507XXXXXXXX or 07XXXXXXXX');
        return;
    }

    sendBtn.innerText = 'Sending...';
    sendBtn.disabled = true;

    try {
        const data = await requestResetCode(method, identifier);

        if (data.success) {
            localStorage.setItem('resetMethod', method);
            localStorage.setItem('resetIdentifier', identifier);
            window.location.href = 'verify-code.html';
        } else {
            alert(data.message || 'Failed to send code');
        }
    } catch (error) {
        console.error(error);
        alert('Unable to send reset code right now.');
    }

    sendBtn.innerText = 'Send Reset Code';
    sendBtn.disabled = false;
});
