(function () {
	if (window.AdminSidebar && typeof window.AdminSidebar.init === 'function') {
		window.AdminSidebar.init();
	}

	const dashboardService = window.AdminDashboardService;
	const ordersService = window.AdminOrdersService;
	const welcomeNode = document.getElementById('dashboardWelcomeText');
	const dateNode = document.getElementById('dashboardCurrentDate');
	const totalSalesNode = document.getElementById('dashboardTotalSales');
	const salesNoteNode = document.getElementById('dashboardSalesNote');
	const ordersCountNode = document.getElementById('dashboardOrdersCount');
	const ordersNoteNode = document.getElementById('dashboardOrdersNote');
	const customersCountNode = document.getElementById('dashboardCustomersCount');
	const customersNoteNode = document.getElementById('dashboardCustomersNote');
	const productsCountNode = document.getElementById('dashboardProductsCount');
	const productsNoteNode = document.getElementById('dashboardProductsNote');
	const activityTableBody = document.getElementById('dashboardActivityTableBody');
	const summaryList = document.getElementById('dashboardSummaryList');
	let refreshTimerId = null;

	if (dateNode) {
		const formatter = new Intl.DateTimeFormat('en-US', {
			month: 'long',
			day: 'numeric',
			year: 'numeric'
		});

		dateNode.textContent = formatter.format(new Date());
	}

	if (welcomeNode) {
		const currentHour = new Date().getHours();
		let greeting = 'Welcome back';

		if (currentHour < 12) {
			greeting = 'Good morning';
		} else if (currentHour < 18) {
			greeting = 'Good afternoon';
		} else {
			greeting = 'Good evening';
		}

		welcomeNode.textContent = `${greeting}. Here is a clean overview of store activity and admin shortcuts.`;
	}

	function renderStats(snapshot) {
		if (!snapshot || !snapshot.stats || !dashboardService) {
			return;
		}

		if (totalSalesNode) totalSalesNode.textContent = dashboardService.formatCurrency(snapshot.stats.totalSales);
		if (salesNoteNode) salesNoteNode.textContent = snapshot.stats.salesNote;
		if (ordersCountNode) ordersCountNode.textContent = Number(snapshot.stats.ordersCount || 0).toLocaleString('en-US');
		if (ordersNoteNode) ordersNoteNode.textContent = snapshot.stats.ordersNote;
		if (customersCountNode) customersCountNode.textContent = Number(snapshot.stats.customersCount || 0).toLocaleString('en-US');
		if (customersNoteNode) customersNoteNode.textContent = snapshot.stats.customersNote;
		if (productsCountNode) productsCountNode.textContent = Number(snapshot.stats.productsCount || 0).toLocaleString('en-US');
		if (productsNoteNode) productsNoteNode.textContent = snapshot.stats.productsNote;

		if (ordersService && typeof ordersService.getOrderStats === 'function') {
			const liveOrderStats = ordersService.getOrderStats();
			const syncState = typeof dashboardService.getSyncState === 'function' ? dashboardService.getSyncState() : null;
			if (ordersCountNode) ordersCountNode.textContent = Number(liveOrderStats.totalOrders || 0).toLocaleString('en-US');
			if (ordersNoteNode) {
				ordersNoteNode.textContent = syncState && syncState.source === 'api'
					? 'Synced from centralized backend analytics with auto-refresh'
					: 'Showing fallback admin snapshot from local cache';
			}
			if (salesNoteNode && syncState?.error) {
				salesNoteNode.textContent = `${snapshot.stats.salesNote} • ${syncState.error}`;
			}
		}
	}

	function renderActivity(snapshot) {
		if (!activityTableBody || !snapshot || !Array.isArray(snapshot.activity) || !dashboardService) {
			return;
		}

		if (!snapshot.activity.length) {
			activityTableBody.innerHTML = '<tr><td colspan="4" class="activity-empty-cell">No real orders, customers, messages, or visits have been recorded yet.</td></tr>';
			return;
		}

		activityTableBody.innerHTML = snapshot.activity.map((item) => `
			<tr>
				<td>${escapeHtml(item.type)}</td>
				<td>${escapeHtml(item.reference)}</td>
				<td><span class="status-pill status-${escapeHtml(item.statusTone)}">${escapeHtml(item.statusLabel)}</span></td>
				<td>${escapeHtml(item.details)}</td>
			</tr>
		`).join('');
	}

	function renderSummary(snapshot) {
		if (!summaryList || !snapshot || !Array.isArray(snapshot.summary)) {
			return;
		}

		summaryList.innerHTML = snapshot.summary.map((entry) => `
			<li>
				<span>${escapeHtml(entry.label)}</span>
				<strong>${escapeHtml(entry.value)}</strong>
			</li>
		`).join('');
	}

	function escapeHtml(value) {
		return String(value || '')
			.replace(/&/g, '&amp;')
			.replace(/</g, '&lt;')
			.replace(/>/g, '&gt;')
			.replace(/"/g, '&quot;')
			.replace(/'/g, '&#39;');
	}

	async function refreshDashboard() {
		if (!dashboardService || typeof dashboardService.createSnapshot !== 'function') {
			return;
		}

		activityTableBody.innerHTML = '<tr><td colspan="4" class="activity-empty-cell">Loading centralized dashboard data...</td></tr>';
		if (summaryList) {
			summaryList.innerHTML = '<li><span>Loading</span><strong>Refreshing backend analytics...</strong></li>';
		}

		if (typeof dashboardService.refresh === 'function') {
			await dashboardService.refresh({ silent: true }).catch((error) => {
				console.warn('Unable to refresh admin dashboard snapshot.', error);
			});
		}

		const snapshot = dashboardService.createSnapshot();
		renderStats(snapshot);
		renderActivity(snapshot);
		renderSummary(snapshot);
	}

	ordersService?.init?.().catch((error) => {
		console.warn('Unable to initialize admin orders service on the dashboard.', error);
	});
	dashboardService?.init?.().then(() => refreshDashboard()).catch((error) => {
		console.warn('Unable to initialize admin dashboard service.', error);
	});

	refreshDashboard();

	window.addEventListener('storage', refreshDashboard);
	window.addEventListener('focus', refreshDashboard);
	if (ordersService && ordersService.EVENT_NAME) {
		window.addEventListener(ordersService.EVENT_NAME, refreshDashboard);
	}
	document.addEventListener('visibilitychange', () => {
		if (!document.hidden) {
			refreshDashboard();
		}
	});

	if (refreshTimerId) {
		window.clearInterval(refreshTimerId);
	}

	refreshTimerId = window.setInterval(() => {
		if (!document.hidden) {
			void refreshDashboard();
		}
	}, 15000);
})();
