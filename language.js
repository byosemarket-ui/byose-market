// ===============================
// 🌐 LANGUAGE SYSTEM (COMPATIBLE)
// ===============================

const LANG_KEY = "byose_market_language";
const LANG_KEYS = ["byose_market_language", "bm_lang", "byose_language"];

// TRANSLATIONS (supported dictionaries only — fr uses English copy until translated)
const translations = {
    rw: {
        login_title: "Injira",
        signup_title: "Iyandikishe",
        email: "Email",
        phone: "Nimero",
        password: "Ijambo ry'ibanga",
        confirm_password: "Emeza ijambo ry'ibanga",
        name: "Amazina yawe",
        login_btn: "Injira",
        signup_btn: "Iyandikishe",
        forgot: "Wibagiwe ijambo ry'ibanga?",
        remember: "Unyibuke",
        no_account: "Nta account ufite?",
        have_account: "Ufite account?",
        signup_link: "Iyandikishe",
        login_link: "Injira",
        back_login: "Subira ku kwinjira"
    },

    en: {
        login_title: "Login",
        signup_title: "Sign Up",
        email: "Email",
        phone: "Phone",
        password: "Password",
        confirm_password: "Confirm Password",
        name: "Full Name",
        login_btn: "Login",
        signup_btn: "Sign Up",
        forgot: "Forgot password?",
        remember: "Remember me",
        no_account: "Don't have an account?",
        have_account: "Already have an account?",
        signup_link: "Sign Up",
        login_link: "Login",
        back_login: "Back to login"
    }
};

function normalizeLang(lang) {
    const value = String(lang || "").trim().toLowerCase();
    if (value === "rw" || value === "en" || value === "fr") return value;
    return "en";
}

function dictionaryFor(lang) {
    const normalized = normalizeLang(lang);
    return translations[normalized] || translations.en;
}

function persistLanguageKeys(lang) {
    const normalized = normalizeLang(lang);
    LANG_KEYS.forEach((key) => {
        try { localStorage.setItem(key, normalized); } catch (_error) {}
    });
    try {
        document.documentElement.setAttribute("lang", normalized);
    } catch (_error) {}
    return normalized;
}

function readSavedLanguage() {
    for (let i = 0; i < LANG_KEYS.length; i += 1) {
        try {
            const value = localStorage.getItem(LANG_KEYS[i]);
            if (value) return normalizeLang(value);
        } catch (_error) {}
    }
    return "en";
}

// ===============================
// 🔄 APPLY LANGUAGE
// ===============================
function applyLanguage(lang) {
    const normalized = normalizeLang(lang);
    const dict = dictionaryFor(normalized);

    document.querySelectorAll("[data-lang]").forEach((el) => {
        const key = el.getAttribute("data-lang");
        if (!key || dict[key] === undefined) return;
        el.innerText = dict[key];
    });

    document.querySelectorAll("[data-lang-placeholder]").forEach((el) => {
        const key = el.getAttribute("data-lang-placeholder");
        if (!key || dict[key] === undefined) return;
        if (el.tagName === "INPUT" || el.tagName === "TEXTAREA") el.placeholder = dict[key];
        else el.setAttribute("placeholder", dict[key]);
    });

    document.querySelectorAll(".auth-bottom-text").forEach((el) => {
        const a = el.querySelector("a");
        const href = (a && (a.getAttribute("href") || "")) || "";
        if (href.endsWith("signup.html")) {
            el.innerHTML = `${dict.no_account} <a href="signup.html">${dict.signup_link}</a>`;
        } else {
            el.innerHTML = `${dict.have_account} <a href="login.html">${dict.login_link}</a>`;
        }
    });

    persistLanguageKeys(normalized);
}

function setLanguage(lang) {
    const normalized = persistLanguageKeys(lang);
    applyLanguage(normalized);
    try {
        window.dispatchEvent(new CustomEvent("byose:languageChanged", { detail: { lang: normalized } }));
    } catch (_error) {}
}

function loadLanguage() {
    const savedLang = readSavedLanguage();
    applyLanguage(savedLang);

    const switcher = document.getElementById("languageSwitcher");
    if (switcher) switcher.value = savedLang;
}

document.addEventListener("DOMContentLoaded", () => {
    loadLanguage();

    const switcher = document.getElementById("languageSwitcher");
    if (switcher) {
        switcher.addEventListener("change", (e) => {
            setLanguage(e.target.value);
        });
    }
});

window.applyLanguage = applyLanguage;
window.setLanguage = setLanguage;
window.loadLanguage = loadLanguage;
