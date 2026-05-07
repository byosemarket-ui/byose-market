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
		elements.resultsText.textContent = 'Loading shared inbox...';
		await service.init?.();
	} catch (error) {
		elements.resultsText.textContent = error?.message || 'Unable to load the shared inbox right now.';
	}

	const elements = {
		searchInput: document.getElementById("messagesSearchInput"),
		statusFilter: document.getElementById("messagesStatusFilter"),
		resultsText: document.getElementById("messagesResultsText"),
		tableBody: document.getElementById("messagesTableBody"),
		mobileGrid: document.getElementById("messagesMobileGrid"),
		stats: {
			total: document.getElementById("messagesTotalStat"),
			newCount: document.getElementById("messagesNewStat"),
			reviewed: document.getElementById("messagesReviewedStat"),
			resolved: document.getElementById("messagesResolvedStat"),
			latest: document.getElementById("messagesLatestNote")
		}
	};

	const state = {
		query: "",
		status: "all"
	};

	function createStatusSelect(message) {
		return `
			<select class="module-inline-select" data-action="status" data-id="${service.escapeHtml(message.id)}">
				${service.STATUS_OPTIONS.map((option) => `<option value="${service.escapeHtml(option)}" ${option === message.status ? "selected" : ""}>${service.escapeHtml(option)}</option>`).join("")}
			</select>
		`;
	}

	function createRow(message) {
		return `
			<tr>
				<td>
					<div class="module-cell-stack">
						<strong>${service.escapeHtml(message.name)}</strong>
						<small>${service.escapeHtml(message.contactLabel)}</small>
					</div>
				</td>
				<td>${service.escapeHtml(service.truncate(message.message, 84))}</td>
				<td><span class="module-status-pill module-status-pill--${service.getStatusTone(message.status)}">${service.escapeHtml(message.status)}</span></td>
				<td>${service.formatDateTime(message.createdAt)}</td>
				<td>${createStatusSelect(message)}</td>
				<td>
					<div class="module-actions-inline">
						<a href="details.html?id=${encodeURIComponent(message.id)}">Open</a>
						<button type="button" data-action="delete" data-id="${service.escapeHtml(message.id)}">Delete</button>
					</div>
				</td>
			</tr>
		`;
	}

	function createCard(message) {
		return `
			<article class="module-mobile-card">
				<div class="module-card-stack">
					<strong>${service.escapeHtml(message.name)}</strong>
					<small>${service.escapeHtml(message.contactLabel)}</small>
					<span class="module-status-pill module-status-pill--${service.getStatusTone(message.status)}">${service.escapeHtml(message.status)}</span>
				</div>
				<p>${service.escapeHtml(service.truncate(message.message, 140))}</p>
				<small>${service.formatDateTime(message.createdAt)}</small>
				${createStatusSelect(message)}
				<div class="module-actions-inline">
					<a href="details.html?id=${encodeURIComponent(message.id)}">Open</a>
					<button type="button" data-action="delete" data-id="${service.escapeHtml(message.id)}">Delete</button>
				</div>
			</article>
		`;
	}

	function renderStats() {
		const stats = service.getMessageStats();
		elements.stats.total.textContent = String(stats.total);
		elements.stats.newCount.textContent = String(stats.newCount);
		elements.stats.reviewed.textContent = String(stats.reviewed);
		elements.stats.resolved.textContent = String(stats.resolved);
		elements.stats.latest.textContent = stats.latestLabel;
	}

	function renderMessages() {
		const messages = service.filterMessages(state);
		elements.resultsText.textContent = `${messages.length} message${messages.length === 1 ? "" : "s"} found`;

		if (!messages.length) {
			elements.tableBody.innerHTML = '<tr><td colspan="6" class="module-empty-row">No real messages match the current filters.</td></tr>';
			elements.mobileGrid.innerHTML = '<div class="module-empty-state">No real messages match the current filters.</div>';
			return;
		}

		elements.tableBody.innerHTML = messages.map(createRow).join("");
		elements.mobileGrid.innerHTML = messages.map(createCard).join("");
	}

	function rerender() {
		renderStats();
		renderMessages();
	}

	function handleClick(event) {
		const button = event.target.closest("[data-action='delete'][data-id]");
		if (!button) {
			return;
		}

		service.deleteMessage(button.dataset.id || "").then(() => {
			elements.resultsText.textContent = 'Message deleted.';
			rerender();
		}).catch((error) => {
			elements.resultsText.textContent = error?.message || 'Unable to delete the selected message right now.';
		});
	}

	function handleChange(event) {
		const select = event.target.closest("select[data-action='status'][data-id]");
		if (!select) {
			return;
		}

		service.updateMessageStatus(select.dataset.id || "", select.value || "New").then(() => {
			elements.resultsText.textContent = `Message ${select.dataset.id || ''} updated to ${select.value || 'New'}.`;
			rerender();
		}).catch((error) => {
			elements.resultsText.textContent = error?.message || 'Unable to update message status right now.';
		});
	}

	elements.searchInput?.addEventListener("input", () => {
		state.query = String(elements.searchInput.value || "");
		renderMessages();
	});

	elements.statusFilter?.addEventListener("change", () => {
		state.status = String(elements.statusFilter.value || "all");
		renderMessages();
	});

	elements.tableBody?.addEventListener("click", handleClick);
		elements.mobileGrid?.addEventListener("click", handleClick);
		elements.tableBody?.addEventListener("change", handleChange);
		elements.mobileGrid?.addEventListener("change", handleChange);

	window.addEventListener("storage", rerender);
	window.addEventListener(service.EVENT_NAME, rerender);

	rerender();
})();
