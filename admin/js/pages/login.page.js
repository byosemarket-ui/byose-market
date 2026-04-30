(function () {
	const auth = window.AdminAuthService;
	const form = document.getElementById("adminLoginForm");
	const feedback = document.getElementById("adminSessionStatus");
	const logoutButton = document.getElementById("adminLogoutButton");
	const sessionName = document.getElementById("adminSessionName");
	const sessionEmail = document.getElementById("adminSessionEmail");
	const dashboardLink = document.getElementById("adminDashboardLink");

	if (!auth || !form) {
		return;
	}

	async function hydrateExistingSession() {
		const session = auth.getSession();
		if (!session) {
			renderSession();
			return;
		}

		const validatedSession = await auth.validateSession({ force: true });
		if (!validatedSession) {
			feedback.textContent = "Admin session not found. Sign in to continue.";
			feedback.className = "login-feedback is-error";
			renderSession();
			return;
		}

		feedback.textContent = "Admin session active. Redirecting to dashboard...";
		feedback.className = "login-feedback is-success";
		renderSession();
		window.setTimeout(() => {
			window.location.replace(auth.getPostLoginRedirectUrl());
		}, 200);
	}

	function renderSession() {
		const session = auth.getSession();
		if (!session) {
			sessionName.textContent = "No active session";
			sessionEmail.textContent = "Sign in with the configured admin account to continue.";
			logoutButton.hidden = true;
			dashboardLink.hidden = true;
			return;
		}

		sessionName.textContent = session.admin?.name || session.name || "Admin";
		sessionEmail.textContent = session.admin?.email || session.email || "No email";
		logoutButton.hidden = false;
		dashboardLink.hidden = false;
	}

	form.addEventListener("submit", async (event) => {
		event.preventDefault();
		feedback.textContent = "Signing in to the admin server...";
		feedback.className = "login-feedback";
		const submitButton = form.querySelector('button[type="submit"]');
		if (submitButton) {
			submitButton.disabled = true;
		}

		const data = new FormData(form);
		const email = String(data.get("email") || "").trim();
		const password = String(data.get("password") || "");
		if (!email || !password) {
			feedback.textContent = "Enter both the admin email and password.";
			feedback.className = "login-feedback is-error";
			if (submitButton) {
				submitButton.disabled = false;
			}
			return;
		}

		try {
			await auth.login({ email, password });
			feedback.textContent = "Admin login successful. Redirecting to dashboard...";
			feedback.className = "login-feedback is-success";
			renderSession();
			window.setTimeout(() => {
				window.location.replace(auth.getPostLoginRedirectUrl());
			}, 250);
		} catch (error) {
			feedback.textContent = error.message || "Invalid admin credentials";
			feedback.className = "login-feedback is-error";
		} finally {
			if (submitButton) {
				submitButton.disabled = false;
			}
		}
	});

	logoutButton?.addEventListener("click", () => {
		auth.logout();
		feedback.textContent = "Admin session cleared.";
		feedback.className = "login-feedback";
		renderSession();
	});

	hydrateExistingSession().catch(() => {
		feedback.textContent = "Unable to verify the admin session with the backend.";
		feedback.className = "login-feedback is-error";
		renderSession();
	});
})();
