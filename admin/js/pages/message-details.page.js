(async function () {
	const sidebar = window.AdminSidebar;
	const service = window.AdminMessagesService;

	if (sidebar && typeof sidebar.init === "function") {
		sidebar.init();
	}

	if (!service) {
		return;
	}

	try {
		await service.init?.();
	} catch (error) {
		feedback.textContent = error?.message || 'Unable to load this message right now.';
		feedback.className = 'module-feedback is-error';
	}

	const params = new URLSearchParams(window.location.search);
	const messageId = String(params.get("id") || "");
	const message = service.getMessageById(messageId);
	const detail = document.getElementById("messageDetailCard");
	const feedback = document.getElementById("messageDetailFeedback");
	const statusSelect = document.getElementById("messageStatusSelect");
	const deleteButton = document.getElementById("messageDeleteButton");

	if (!detail) {
		return;
	}

	if (!message) {
		detail.innerHTML = '<div class="module-empty-state">The selected message could not be found.</div>';
		if (statusSelect) {
			statusSelect.disabled = true;
		}
		if (deleteButton) {
			deleteButton.disabled = true;
		}
		return;
	}

	if (statusSelect) {
		statusSelect.innerHTML = service.STATUS_OPTIONS.map((option) => `<option value="${service.escapeHtml(option)}" ${option === message.status ? "selected" : ""}>${service.escapeHtml(option)}</option>`).join("");
	}

	detail.innerHTML = `
		<div class="module-detail-head">
			<div>
				<p class="dashboard-eyebrow">Message Details</p>
				<h2>${service.escapeHtml(message.name)}</h2>
			</div>
			<span class="module-status-pill module-status-pill--${service.getStatusTone(message.status)}">${service.escapeHtml(message.status)}</span>
		</div>
		<dl class="module-data-list">
			<div><dt>Reference</dt><dd>${service.escapeHtml(message.id)}</dd></div>
			<div><dt>Date</dt><dd>${service.formatDateTime(message.createdAt)}</dd></div>
			<div><dt>Email</dt><dd>${service.escapeHtml(message.email || "Not provided")}</dd></div>
			<div><dt>Phone</dt><dd>${service.escapeHtml(message.phone || "Not provided")}</dd></div>
			<div><dt>Source</dt><dd>${service.escapeHtml(message.source)}</dd></div>
			<div><dt>Contact</dt><dd>${service.escapeHtml(message.contactLabel)}</dd></div>
		</dl>
		<div class="module-note-box">${service.escapeHtml(message.message || "No message body was captured.")}</div>
	`;

	statusSelect?.addEventListener("change", () => {
		service.updateMessageStatus(message.id, statusSelect.value || "New").then(() => {
			feedback.textContent = "Message status updated.";
			feedback.className = "module-feedback is-success";
		}).catch((error) => {
			feedback.textContent = error?.message || 'Unable to update the message status right now.';
			feedback.className = 'module-feedback is-error';
		});
	});

	deleteButton?.addEventListener("click", () => {
		service.deleteMessage(message.id).then(() => {
			window.location.href = "index.html";
		}).catch((error) => {
			feedback.textContent = error?.message || 'Unable to delete the message right now.';
			feedback.className = 'module-feedback is-error';
		});
	});
})();
