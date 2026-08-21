let loginBtn, loginForm, emailInput, phoneInput, passwordInputLogin, feedbackHost;
let messageTimer = null;
let isSubmitting = false;

// ===============================
// 🧠 SESSION HELPERS
// ===============================
function setSession(user) {
    if (window.authService && typeof window.authService.setCurrentUser === 'function') {
        try {
            window.authService.setCurrentUser(user);
            return;
        } catch (e) {
            console.error(e);
        }
    }

    if (typeof window.setCurrentUser === 'function') {
        try { window.setCurrentUser(user); } catch (e) { console.error(e); }
    }
}

function isLoggedIn() {
    if (window.authService && typeof window.authService.isLoggedIn === 'function') {
        try { return !!window.authService.isLoggedIn(); } catch (e) { /* fallback */ }
    }

    if (typeof window.isLoggedIn === 'function') {
        try { return !!window.isLoggedIn(); } catch (e) { /* fallback */ }
    }

    return false;
}

function getPostLoginDestination() {
    try {
        const next = new URLSearchParams(window.location.search).get('next');
        if (!next || !next.startsWith('/') || next.startsWith('//')) {
            return 'shop.html';
        }

        const target = new URL(next, window.location.origin);
        return target.origin === window.location.origin
            ? `${target.pathname}${target.search}${target.hash}`
            : 'shop.html';
    } catch (e) {
        return 'shop.html';
    }
}

// ===============================
// 🧠 MODE
// ===============================
function isEmailMode() {
    const ef = document.getElementById("emailField");
    return ef && !ef.hidden && ef.style.display !== "none";
}

function getFieldGroup(input) {
    return input ? input.closest('.input-group') : null;
}

function setFieldState(input, state, message) {
    const group = getFieldGroup(input);
    if (!group) return;

    const meta = group.querySelector('.field-meta');
    group.classList.remove('has-error', 'has-success');

    if (state === 'error') {
        group.classList.add('has-error');
        input.setAttribute('aria-invalid', 'true');
    } else if (state === 'success') {
        group.classList.add('has-success');
        input.removeAttribute('aria-invalid');
    } else {
        input.removeAttribute('aria-invalid');
    }

    if (meta) {
        if (!meta.dataset.defaultText) {
            meta.dataset.defaultText = meta.textContent;
        }
        meta.textContent = message || meta.dataset.defaultText;
    }
}

function clearFieldState(input) {
    setFieldState(input, 'default');
}

function clearMessages() {
    if (messageTimer) {
        clearTimeout(messageTimer);
        messageTimer = null;
    }
    if (feedbackHost) {
        feedbackHost.innerHTML = '';
    }
}

function showMessage(type, message, duration) {
    clearMessages();

    if (!feedbackHost) {
        alert(message);
        return;
    }

    const div = document.createElement('div');
    div.className = `auth-message ${type}`;
    div.textContent = message;
    feedbackHost.appendChild(div);

    if (duration) {
        messageTimer = setTimeout(() => {
            if (div.parentNode) {
                div.remove();
            }
            messageTimer = null;
        }, duration);
    }
}

function showError(message) {
    showMessage('error', message, 4000);
}

function showSuccess(message) {
    showMessage('success', message, 2200);
}

function setLoadingState(loading) {
    if (!loginBtn) return;

    isSubmitting = loading;
    loginBtn.disabled = loading;
    loginBtn.classList.toggle('is-loading', loading);
    loginBtn.setAttribute('aria-busy', loading ? 'true' : 'false');

    const label = loginBtn.querySelector('.btn-label');
    if (label) {
        label.textContent = loading ? 'Turimo kwinjira...' : 'Injira';
    }
}

function validateIdentifierField() {
    if (isEmailMode()) {
        const email = emailInput.value.trim();
        if (!email) {
            setFieldState(emailInput, 'error', 'Andika email yawe mbere yo gukomeza.');
            return false;
        }
        if (!validation.isValidEmail(email)) {
            setFieldState(emailInput, 'error', 'Andika email iri mu buryo bwemewe.');
            return false;
        }
        setFieldState(emailInput, 'success', 'Email yawe isa n’iyanditse neza.');
        clearFieldState(phoneInput);
        return true;
    }

    const phone = phoneInput.value.trim();
    if (!phone) {
        setFieldState(phoneInput, 'error', 'Andika nimero ya telefone mbere yo gukomeza.');
        return false;
    }
    if (!validation.isValidPhone(phone)) {
        setFieldState(phoneInput, 'error', 'Andika nimero ya telefone iri mu buryo bwemewe.');
        return false;
    }
    setFieldState(phoneInput, 'success', 'Telefone yawe isa n’iyanditse neza.');
    clearFieldState(emailInput);
    return true;
}

function validatePasswordField() {
    const password = passwordInputLogin.value.trim();

    if (!password) {
        setFieldState(passwordInputLogin, 'error', 'Andika password yawe mbere yo gukomeza.');
        return false;
    }

    setFieldState(passwordInputLogin, 'success', 'Password yashyizwemo.');
    return true;
}

function validateInputs() {
    const identifierOk = validateIdentifierField();
    const passwordOk = validatePasswordField();

    if (!identifierOk) {
        showError(isEmailMode() ? 'Shyiramo email iri mu buryo bwemewe.' : 'Shyiramo nimero ya telefone iri mu buryo bwemewe.');
        return false;
    }

    if (!passwordOk) {
        showError('Password irakenewe kugira ngo winjire.');
        return false;
    }

    clearMessages();
    return true;
}

function bindFieldInteractions() {
    [emailInput, phoneInput, passwordInputLogin].forEach((input) => {
        if (!input) return;

        const clearCurrentState = () => {
            const group = getFieldGroup(input);
            if (group && group.classList.contains('has-error')) {
                clearFieldState(input);
            }
        };

        input.addEventListener('input', clearCurrentState);
        input.addEventListener('blur', () => {
            if (input === passwordInputLogin) {
                if (input.value.trim()) validatePasswordField();
                return;
            }

            if (input === emailInput && isEmailMode() && input.value.trim()) {
                validateIdentifierField();
            }

            if (input === phoneInput && !isEmailMode() && input.value.trim()) {
                validateIdentifierField();
            }
        });
    });
}

function bindLogin() {
    if (!loginForm) return;

    loginForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        if (isSubmitting) return;
        if (!validateInputs()) return;

        const identifier = isEmailMode()
            ? emailInput.value.trim()
            : phoneInput.value.trim();

        const password = passwordInputLogin.value;
        const rememberMe = document.getElementById('rememberMe');
        const remember = rememberMe ? Boolean(rememberMe.checked) : true;

        setLoadingState(true);

        try {
            const res = await authService.loginByIdentifier(identifier, password, { remember });

            if (!res || !res.success) {
                const err = res && res.error;
                if (err === 'user_not_found') {
                    setFieldState(isEmailMode() ? emailInput : phoneInput, 'error', 'Nta account ibonetse kuri ibyo winjije.');
                    showError('Nta account ibonetse kuri email cyangwa telefone winjije.');
                } else if (err === 'account_blocked') {
                    setFieldState(isEmailMode() ? emailInput : phoneInput, 'error', 'Iyi account yahagaritswe n\'ubuyobozi.');
                    showError('Iyi account yahagaritswe. Saba ubufasha bwa support niba utekereza ko ari ikosa.');
                } else if (err === 'invalid_password') {
                    setFieldState(passwordInputLogin, 'error', 'Password wanditse si yo.');
                    showError('Password si yo. Ongera ugerageze.');
                } else if (err === 'account_locked') {
                    showError('Wagerageje inshuro nyinshi. Gerageza nyuma gato.');
                } else if (err === 'empty_identifier') {
                    setFieldState(isEmailMode() ? emailInput : phoneInput, 'error', 'Andika email cyangwa telefone mbere yo gukomeza.');
                    showError('Andika email cyangwa telefone mbere yo gukomeza.');
                } else {
                    showError('Kwinjira byanze. Ongera ugerageze nyuma gato.');
                }
                return;
            }

            try { setSession(res.user); } catch (e) { console.error(e); }

            try {
                if (window.ByoseWishlist && typeof window.ByoseWishlist.mergeLocalToServer === 'function') {
                    window.ByoseWishlist.mergeLocalToServer().catch(() => {});
                }
            } catch (e) { console.error(e); }

            try {
                if (window.recentlyViewedTracker && typeof window.recentlyViewedTracker.mergeLocalToServer === 'function') {
                    window.recentlyViewedTracker.mergeLocalToServer().catch(() => {});
                }
            } catch (e) { console.error(e); }

            try {
                localStorage.removeItem('bm_last_identifier');
                localStorage.removeItem('bm_last_password');
                sessionStorage.removeItem('bm_last_password');
            } catch (e) { console.error(e); }

            setFieldState(isEmailMode() ? emailInput : phoneInput, 'success', 'Byemejwe.');
            setFieldState(passwordInputLogin, 'success', 'Login yemejwe.');
            showSuccess('Kwinjira byakunze. Turakujyana kuri shop...');

            window.setTimeout(() => {
                window.location.href = getPostLoginDestination();
            }, 700);
        } finally {
            window.setTimeout(() => {
                setLoadingState(false);
            }, 250);
        }
    });
}

// ===============================
// 🔄 AUTO LOGIN CHECK
// ===============================
document.addEventListener("DOMContentLoaded", () => {
    loginBtn = document.getElementById("loginBtn");
    loginForm = document.getElementById('loginForm');
    emailInput = document.getElementById("email");
    phoneInput = document.getElementById("phone");
    passwordInputLogin = document.getElementById("password");
    feedbackHost = document.getElementById('authFeedback');

    [emailInput, phoneInput, passwordInputLogin].forEach((input) => {
        const meta = getFieldGroup(input) && getFieldGroup(input).querySelector('.field-meta');
        if (meta && !meta.dataset.defaultText) {
            meta.dataset.defaultText = meta.textContent;
        }
    });

    // Autofill after signup: populate login fields from temporary signup storage
    try {
        const lastIdentifier = localStorage.getItem('bm_last_identifier');
        const emailFieldEl = document.getElementById('emailField');
        const phoneFieldEl = document.getElementById('phoneField');
        const emailBtnEl = document.getElementById('emailBtn');
        const phoneBtnEl = document.getElementById('phoneBtn');
        if (lastIdentifier) {
            // choose mode based on presence of @ in identifier
            const isEmail = lastIdentifier.indexOf('@') !== -1;
            if (isEmail && emailInput) {
                if (emailFieldEl) emailFieldEl.style.display = '';
                if (emailFieldEl) emailFieldEl.hidden = false;
                if (phoneFieldEl) phoneFieldEl.style.display = 'none';
                if (phoneFieldEl) phoneFieldEl.hidden = true;
                if (emailBtnEl) emailBtnEl.classList.add('active');
                if (phoneBtnEl) phoneBtnEl.classList.remove('active');
                if (emailBtnEl) emailBtnEl.setAttribute('aria-pressed', 'true');
                if (phoneBtnEl) phoneBtnEl.setAttribute('aria-pressed', 'false');
                emailInput.value = lastIdentifier;
            } else if (!isEmail && phoneInput) {
                if (emailFieldEl) emailFieldEl.style.display = 'none';
                if (emailFieldEl) emailFieldEl.hidden = true;
                if (phoneFieldEl) phoneFieldEl.style.display = '';
                if (phoneFieldEl) phoneFieldEl.hidden = false;
                if (emailBtnEl) emailBtnEl.classList.remove('active');
                if (phoneBtnEl) phoneBtnEl.classList.add('active');
                if (emailBtnEl) emailBtnEl.setAttribute('aria-pressed', 'false');
                if (phoneBtnEl) phoneBtnEl.setAttribute('aria-pressed', 'true');
                phoneInput.value = lastIdentifier;
            }
        }

        try {
            localStorage.removeItem('bm_last_password');
        } catch (e) {}
    } catch (e) { console.error(e); }

    // ✅ niba user asanzwe yinjiye
    if (isLoggedIn()) {
        window.location.href = getPostLoginDestination();
        return;
    }

    bindFieldInteractions();
    if (loginBtn) bindLogin();
});