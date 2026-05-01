(function () {
	"use strict";

	const loginForm = document.getElementById("adminLoginForm");
	const emailInput = document.getElementById("adminEmail");
	const passwordInput = document.getElementById("adminPassword");
	const errorMessage = document.getElementById("loginErrorMessage");
	const loginButton = document.getElementById("loginButton");

	if (!loginForm || !emailInput || !passwordInput || !errorMessage || !loginButton) {
		return;
	}

	function showMessage(message, type) {
		errorMessage.textContent = String(message || "");
		errorMessage.className = "login-message";

		if (!message) {
			return;
		}

		errorMessage.classList.add("is-visible");

		if (type === "success") {
			errorMessage.classList.add("is-success");
		}
	}

	function setSubmittingState(isSubmitting) {
		loginButton.disabled = isSubmitting;
		loginButton.textContent = isSubmitting ? "Signing In..." : "Sign In";
	}

	function humanizeError(error) {
		const message = error && error.message ? String(error.message) : "";
		const code = error && error.code ? String(error.code) : "";
		const status = error && typeof error.status === "number" ? error.status : 0;

		if (code === "INVALID_CREDENTIALS" || status === 401) {
			return "Invalid email or password.";
		}

		if (code === "NETWORK_UNREACHABLE") {
			return "Unable to reach the admin server. Check that the backend is running and publicly accessible.";
		}

		if (code === "API_ROUTE_NOT_FOUND" || status === 404) {
			return "Admin login API is not available at /api/admin/login.";
		}

		if (code === "SERVER_ERROR" || status >= 500) {
			return "Server error. Please try again later.";
		}

		if (!message || /failed to fetch|networkerror|load failed|network request failed|cors|origin not allowed/i.test(message)) {
			return "Unable to reach the admin server. Check that the backend is running and publicly accessible.";
		}

		if (/invalid.*credential|invalid.*email|invalid.*password/i.test(message)) {
			return "Invalid email or password.";
		}

		if (/not.*available|404|missing route/i.test(message)) {
			return "Admin login API is not available. The backend may not be running.";
		}

		if (/server error|500/i.test(message)) {
			return "Server error. Please try again later.";
		}

		return message;
	}

	loginForm.addEventListener("submit", async function (event) {
		event.preventDefault();

		const email = String(emailInput.value || "").trim();
		const password = String(passwordInput.value || "");

		showMessage("");

		if (!email || !password) {
			showMessage("Please enter both email and password.", "error");
			return;
		}

		setSubmittingState(true);

		try {
			await window.AdminAuthService.login({ email, password });
			showMessage("Login successful. Redirecting to dashboard...", "success");

			window.setTimeout(function () {
				window.location.replace(window.AdminAuthService.getDashboardUrl());
			}, 250);
		} catch (error) {
			showMessage(humanizeError(error), "error");
		} finally {
			setSubmittingState(false);
		}
	});
})();