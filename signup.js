let signupBtn;
let signupForm;
let nameInput;
let emailInputSignup;
let phoneInputSignup;
let passwordInputSignup;
let confirmPasswordInput;
let feedbackHost;
let toggleConfirmPasswordEl;
let messageTimer = null;
let isSubmitting = false;

let pwMinEl;
let pwUpperEl;
let pwLowerEl;
let pwNumberEl;
let pwStrengthBar;
let pwStrengthText;
let pwMatchEl;

function isEmailMode() {
    const emailField = document.getElementById('emailField');
    return emailField && !emailField.hidden && emailField.style.display !== 'none';
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
        messageTimer = window.setTimeout(() => {
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
    if (!signupBtn) return;

    isSubmitting = loading;
    signupBtn.disabled = loading;
    signupBtn.classList.toggle('is-loading', loading);
    signupBtn.setAttribute('aria-busy', loading ? 'true' : 'false');

    const label = signupBtn.querySelector('.btn-label');
    if (label) {
        label.textContent = loading ? 'Turimo gukora account...' : 'Iyandikishe';
    }
}

function updateCriteria(element, isValid) {
    if (!element) return;

    element.classList.toggle('valid', isValid);
    element.classList.toggle('invalid', !isValid);

    const icon = element.querySelector('.icon');
    if (icon) {
        icon.textContent = isValid ? 'OK' : 'x';
    }
}

function refreshPasswordState() {
    if (!passwordInputSignup || !confirmPasswordInput) return;

    const password = passwordInputSignup.value || '';
    const confirmPassword = confirmPasswordInput.value || '';

    const min = validation.hasMinLength(password);
    const upper = validation.hasUppercase(password);
    const lower = validation.hasLowercase(password);
    const number = validation.hasNumber(password);
    const match = !!password && password === confirmPassword;
    const strength = validation.passwordStrength(password);

    updateCriteria(pwMinEl, min);
    updateCriteria(pwUpperEl, upper);
    updateCriteria(pwLowerEl, lower);
    updateCriteria(pwNumberEl, number);
    updateCriteria(pwMatchEl, match);

    if (pwMatchEl) {
        const text = pwMatchEl.querySelector('span:last-child');
        if (text) {
            text.textContent = match ? 'Passwords match' : 'Passwords do not match';
        }
    }

    if (pwStrengthBar) {
        const width = Math.min(100, (strength.score / 4) * 100);
        pwStrengthBar.style.width = `${width}%`;
        pwStrengthBar.classList.remove('weak', 'medium', 'strong');
        pwStrengthBar.classList.add((strength.label || 'Weak').toLowerCase());
    }

    if (pwStrengthText) {
        pwStrengthText.textContent = strength.label;
    }

    if (!password) {
        clearFieldState(passwordInputSignup);
    } else if (min && upper && lower && number) {
        setFieldState(passwordInputSignup, 'success', 'Password yujuje ibisabwa byose.');
    } else {
        setFieldState(passwordInputSignup, 'error', 'Komeza wongere password yujuje ibisabwa byose hejuru.');
    }

    if (!confirmPassword) {
        clearFieldState(confirmPasswordInput);
    } else if (match) {
        setFieldState(confirmPasswordInput, 'success', 'Passwords zirahuye neza.');
    } else {
        setFieldState(confirmPasswordInput, 'error', 'Confirm password igomba guhura na password ya mbere.');
    }
}

function validateNameField() {
    const name = nameInput.value.trim();
    if (!name) {
        setFieldState(nameInput, 'error', 'Andika amazina yawe mbere yo gukomeza.');
        return false;
    }

    if (!validation.isValidName(name)) {
        setFieldState(nameInput, 'error', 'Andika amazina nibura arenga inyuguti ebyiri.');
        return false;
    }

    setFieldState(nameInput, 'success', 'Amazina yawe yanditswe neza.');
    return true;
}

function validateIdentifierField() {
    if (isEmailMode()) {
        const email = emailInputSignup.value.trim();
        if (!email) {
            setFieldState(emailInputSignup, 'error', 'Andika email mbere yo gukomeza.');
            return false;
        }
        if (!validation.isValidEmail(email)) {
            setFieldState(emailInputSignup, 'error', 'Andika email iri mu buryo bwemewe.');
            return false;
        }
        setFieldState(emailInputSignup, 'success', 'Email yawe isa n iyanditse neza.');
        clearFieldState(phoneInputSignup);
        return true;
    }

    const phone = phoneInputSignup.value.trim();
    if (!phone) {
        setFieldState(phoneInputSignup, 'error', 'Andika nimero ya telefone mbere yo gukomeza.');
        return false;
    }
    if (!validation.isValidPhone(phone)) {
        setFieldState(phoneInputSignup, 'error', 'Andika telefone iri mu buryo bwemewe.');
        return false;
    }
    setFieldState(phoneInputSignup, 'success', 'Telefone yawe isa n iyanditse neza.');
    clearFieldState(emailInputSignup);
    return true;
}

function validatePasswordFields() {
    const password = passwordInputSignup.value;
    const confirmPassword = confirmPasswordInput.value;

    if (!validation.isStrongPassword(password)) {
        setFieldState(passwordInputSignup, 'error', 'Password yawe igomba kugira uppercase, lowercase, number na length ihagije.');
        return false;
    }

    if (!confirmPassword) {
        setFieldState(confirmPasswordInput, 'error', 'Ongera wandike password kugira ngo tuyemeze.');
        return false;
    }

    if (password !== confirmPassword) {
        setFieldState(confirmPasswordInput, 'error', 'Passwords ebyiri zigomba guhura.');
        return false;
    }

    setFieldState(passwordInputSignup, 'success', 'Password yawe yemerewe gukoreshwa.');
    setFieldState(confirmPasswordInput, 'success', 'Passwords zirahuye neza.');
    return true;
}

function validateSignup() {
    const nameOk = validateNameField();
    const identifierOk = validateIdentifierField();
    const passwordOk = validatePasswordFields();

    if (!nameOk) {
        showError('Andika amazina yawe neza mbere yo gukomeza.');
        return false;
    }

    if (!identifierOk) {
        showError(isEmailMode() ? 'Shyiramo email iri mu buryo bwemewe.' : 'Shyiramo nimero ya telefone iri mu buryo bwemewe.');
        return false;
    }

    if (!passwordOk) {
        showError('Password igomba kuba ikomeye kandi confirm password ikayihura.');
        return false;
    }

    clearMessages();
    return true;
}

function toggleInputVisibility(input, toggleButton) {
    if (!input || !toggleButton) return;

    const isHidden = input.type === 'password';
    input.type = isHidden ? 'text' : 'password';
    toggleButton.setAttribute('aria-label', isHidden ? 'Hide password' : 'Show password');
    toggleButton.innerHTML = isHidden
        ? '<i class="fa fa-eye-slash"></i>'
        : '<i class="fa fa-eye"></i>';
}

function bindFieldInteractions() {
    [nameInput, emailInputSignup, phoneInputSignup, passwordInputSignup, confirmPasswordInput].forEach((input) => {
        if (!input) return;

        input.addEventListener('input', () => {
            const group = getFieldGroup(input);
            if (group && group.classList.contains('has-error')) {
                clearFieldState(input);
            }

            if (input === passwordInputSignup || input === confirmPasswordInput) {
                refreshPasswordState();
            }
        });

        input.addEventListener('blur', () => {
            if (input === nameInput && input.value.trim()) {
                validateNameField();
            }

            if (input === emailInputSignup && isEmailMode() && input.value.trim()) {
                validateIdentifierField();
            }

            if (input === phoneInputSignup && !isEmailMode() && input.value.trim()) {
                validateIdentifierField();
            }

            if ((input === passwordInputSignup || input === confirmPasswordInput) && (passwordInputSignup.value || confirmPasswordInput.value)) {
                validatePasswordFields();
                refreshPasswordState();
            }
        });
    });
}

function bindModeSwitchFeedback() {
    const emailBtn = document.getElementById('emailBtn');
    const phoneBtn = document.getElementById('phoneBtn');

    if (emailBtn) {
        emailBtn.addEventListener('click', () => {
            clearMessages();
            clearFieldState(phoneInputSignup);
        });
    }

    if (phoneBtn) {
        phoneBtn.addEventListener('click', () => {
            clearMessages();
            clearFieldState(emailInputSignup);
        });
    }
}

function bindSignup() {
    if (!signupForm) return;

    signupForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        if (isSubmitting) return;
        if (!validateSignup()) return;

        const user = {
            name: nameInput.value.trim(),
            email: isEmailMode() ? emailInputSignup.value.trim().toLowerCase() : '',
            phone: isEmailMode() ? '' : phoneInputSignup.value.trim(),
            password: passwordInputSignup.value,
            provider: 'manual'
        };

        setLoadingState(true);

        try {
            const result = await authService.register(user);

            if (!result || !result.success) {
                const error = result && result.error;

                if (error === 'email_exists') {
                    setFieldState(emailInputSignup, 'error', 'Iyi email isanzwe ifite account. Injira cyangwa ukoreshe indi email.');
                    showError('Hari account isanzwe ikoresha iyi email.');
                } else if (error === 'phone_exists') {
                    setFieldState(phoneInputSignup, 'error', 'Iyi nimero isanzwe ifite account. Injira cyangwa ukoreshe indi nimero.');
                    showError('Hari account isanzwe ikoresha iyi nimero ya telefone.');
                } else if (error === 'invalid_email') {
                    setFieldState(emailInputSignup, 'error', 'Email wanditse ntiyemewe.');
                    showError('Email wanditse ntiyemewe.');
                } else if (error === 'invalid_phone') {
                    setFieldState(phoneInputSignup, 'error', 'Telefone wanditse ntiyemewe.');
                    showError('Telefone wanditse ntiyemewe.');
                } else if (error === 'weak_password') {
                    setFieldState(passwordInputSignup, 'error', 'Password iracyari yoroshye. Hindura uko yubatswe.');
                    showError('Password iracyari yoroshye.');
                } else {
                    showError('Kwiyandikisha byanze. Ongera ugerageze nyuma gato.');
                }
                return;
            }

            showSuccess('Account yawe yakozwe neza. Turakujyana kuri shop...');

            window.setTimeout(() => {
                window.location.href = 'shop.html';
            }, 900);
        } finally {
            setLoadingState(false);
        }
    });
}

document.addEventListener('DOMContentLoaded', () => {
    signupBtn = document.getElementById('signupBtn');
    signupForm = document.getElementById('signupForm');
    nameInput = document.getElementById('name');
    emailInputSignup = document.getElementById('email');
    phoneInputSignup = document.getElementById('phone');
    passwordInputSignup = document.getElementById('password');
    confirmPasswordInput = document.getElementById('confirmPassword');
    feedbackHost = document.getElementById('authFeedback');
    toggleConfirmPasswordEl = document.getElementById('toggleConfirmPassword');

    pwMinEl = document.getElementById('pw-min');
    pwUpperEl = document.getElementById('pw-upper');
    pwLowerEl = document.getElementById('pw-lower');
    pwNumberEl = document.getElementById('pw-number');
    pwStrengthBar = document.getElementById('pwStrengthBar');
    pwStrengthText = document.getElementById('pwStrengthText');
    pwMatchEl = document.getElementById('pw-match');

    if (toggleConfirmPasswordEl && confirmPasswordInput) {
        toggleConfirmPasswordEl.addEventListener('click', () => {
            toggleInputVisibility(confirmPasswordInput, toggleConfirmPasswordEl);
        });
    }

    bindFieldInteractions();
    bindModeSwitchFeedback();
    refreshPasswordState();
    bindSignup();
});