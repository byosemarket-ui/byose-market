(function () {
	const icon = {
		dashboard: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 13h7V4H4v9Zm9 7h7v-5h-7v5Zm0-9h7V4h-7v7ZM4 20h7v-5H4v5Z" fill="currentColor"/></svg>',
		products: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 4.5 7.5 12 12l7.5-4.5L12 3Zm-7.5 6v7.5L12 21l7.5-4.5V9" fill="none" stroke="currentColor" stroke-linejoin="round" stroke-width="1.7"/><path d="M12 12v9" fill="none" stroke="currentColor" stroke-linecap="round" stroke-width="1.7"/></svg>',
		orders: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4.5h10a2 2 0 0 1 2 2v13l-3-2-3 2-3-2-3 2v-13a2 2 0 0 1 2-2Z" fill="none" stroke="currentColor" stroke-linejoin="round" stroke-width="1.7"/><path d="M9 9h6M9 12.5h6" fill="none" stroke="currentColor" stroke-linecap="round" stroke-width="1.7"/></svg>',
		customers: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16 19v-1a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v1" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.7"/><circle cx="9.5" cy="7" r="3" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M20 19v-1a4 4 0 0 0-3-3.87" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.7"/></svg>',
		categories: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h7V4H4v3Zm9 0h7V4h-7v3ZM4 13h7v-3H4v3Zm9 0h7v-3h-7v3ZM4 20h7v-4H4v4Zm9 0h7v-4h-7v4Z" fill="currentColor"/></svg>',
		reviews: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 17.3-5.2 3 1.4-5.8L3.5 10l6-.5L12 4l2.5 5.5 6 .5-4.7 4.5 1.4 5.8-5.2-3Z" fill="none" stroke="currentColor" stroke-linejoin="round" stroke-width="1.7"/></svg>',
		messages: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 6.5h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H9l-5 3v-13a2 2 0 0 1 1-2Z" fill="none" stroke="currentColor" stroke-linejoin="round" stroke-width="1.7"/><path d="m7 10 5 3 5-3" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.7"/></svg>',
		media: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v11a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 17.5v-11Z" fill="none" stroke="currentColor" stroke-width="1.7"/><circle cx="9" cy="9" r="1.6" fill="currentColor"/><path d="m6.5 17 4.2-4.2 2.8 2.8 2-2 2.5 3.4" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.7"/></svg>',
		homepage: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 11.5 12 5l8 6.5" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.7"/><path d="M6 10.5v8.5h12v-8.5" fill="none" stroke="currentColor" stroke-linejoin="round" stroke-width="1.7"/><path d="M10 19v-5h4v5" fill="none" stroke="currentColor" stroke-linejoin="round" stroke-width="1.7"/></svg>',
		settings: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 8.2a3.8 3.8 0 1 0 0 7.6 3.8 3.8 0 0 0 0-7.6Z" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="m4 13.2 1.4.8.2 1.6-1 1.3 1.8 3 1.6-.3 1.2 1 1.7-.3.8 1.5h3.6l.8-1.5 1.7.3 1.2-1 1.6.3 1.8-3-1-1.3.2-1.6 1.4-.8v-2.4l-1.4-.8-.2-1.6 1-1.3-1.8-3-1.6.3-1.2-1-1.7.3-.8-1.5h-3.6l-.8 1.5-1.7-.3-1.2 1-1.6-.3-1.8 3 1 1.3-.2 1.6-1.4.8v2.4Z" fill="none" stroke="currentColor" stroke-linejoin="round" stroke-width="1.4"/></svg>',
		auth: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 8V6.5A3.5 3.5 0 0 0 11.5 3 3.5 3.5 0 0 0 8 6.5V8" fill="none" stroke="currentColor" stroke-linecap="round" stroke-width="1.7"/><rect x="5" y="8" width="14" height="12" rx="2" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M12 13v2.5" fill="none" stroke="currentColor" stroke-linecap="round" stroke-width="1.7"/></svg>'
	};

	const navigation = [
		{
			group: 'Overview',
			items: [
				{
					label: 'Dashboard',
					description: 'Main admin overview',
					href: 'dashboard.html',
					icon: icon.dashboard
				}
			]
		},
		{
			group: 'Commerce',
			items: [
				{
					label: 'Products',
					description: 'Catalog and product pages',
					href: 'products/index.html',
					icon: icon.products,
					children: [
						{ label: 'All Products', href: 'products/index.html' },
						{ label: 'Create Product', href: 'products/create.html' },
						{ label: 'Edit Product', href: 'products/edit.html' },
						{ label: 'View Product', href: 'products/view.html' }
					]
				},
				{
					label: 'Orders',
					description: 'Order tracking and details',
					href: 'orders/index.html',
					icon: icon.orders,
					children: [
						{ label: 'All Orders', href: 'orders/index.html' },
						{ label: 'Order Details', href: 'orders/details.html' }
					]
				},
				{
					label: 'Customers',
					description: 'User and customer records',
					href: 'customers/index.html',
					icon: icon.customers,
					children: [
						{ label: 'Customer List', href: 'customers/index.html' },
						{ label: 'Customer Profile', href: 'customers/profile.html' }
					]
				},
				{
					label: 'Categories',
					description: 'Catalog structure',
					href: 'categories/index.html',
					icon: icon.categories,
					children: [
						{ label: 'Category List', href: 'categories/index.html' },
						{ label: 'Category Form', href: 'categories/form.html' }
					]
				}
			]
		},
		{
			group: 'Content',
			items: [
				{
					label: 'Homepage',
					description: 'Hero, banners, featured content',
					href: 'homepage/index.html',
					icon: icon.homepage,
					children: [
						{ label: 'Homepage Overview', href: 'homepage/index.html' },
						{ label: 'Hero Slides', href: 'homepage/hero.html' },
						{ label: 'Featured Sections', href: 'homepage/featured.html' },
						{ label: 'Banner Blocks', href: 'homepage/banners.html' }
					]
				},
				{
					label: 'Media',
					description: 'Assets and uploads',
					href: 'media/index.html',
					icon: icon.media,
					children: [
						{ label: 'Media Library', href: 'media/index.html' },
						{ label: 'Upload Media', href: 'media/upload.html' }
					]
				},
				{
					label: 'Messages',
					description: 'Inbox and message details',
					href: 'messages/index.html',
					icon: icon.messages,
					children: [
						{ label: 'Messages List', href: 'messages/index.html' },
						{ label: 'Message Details', href: 'messages/details.html' }
					]
				},
				{
					label: 'Reviews',
					description: 'Moderation and review detail',
					href: 'reviews/index.html',
					icon: icon.reviews,
					children: [
						{ label: 'Reviews List', href: 'reviews/index.html' },
						{ label: 'Review Details', href: 'reviews/details.html' }
					]
				}
			]
		},
		{
			group: 'System',
			items: [
				{
					label: 'Settings',
					description: 'General, SEO, delivery, branding',
					href: 'settings/index.html',
					icon: icon.settings,
					children: [
						{ label: 'Settings Overview', href: 'settings/index.html' },
						{ label: 'General', href: 'settings/general.html' },
						{ label: 'Branding', href: 'settings/branding.html' },
						{ label: 'Delivery', href: 'settings/delivery.html' },
						{ label: 'SEO', href: 'settings/seo.html' }
					]
				},
				{
					label: 'Admin Login',
					description: 'Authentication entry page',
					href: 'login.html',
					icon: icon.auth
				}
			]
		}
	];

	let initialized = false;

	function normalize(path) {
		return String(path || '').replace(/\\/g, '/').replace(/^\/+/, '').toLowerCase();
	}

	function getAdminBasePath() {
		const path = String(window.location.pathname || '').replace(/\\/g, '/');
		const marker = '/admin/';
		const markerIndex = path.toLowerCase().indexOf(marker);

		if (markerIndex !== -1) {
			return path.slice(0, markerIndex + marker.length);
		}

		const segments = path.split('/');
		segments.pop();

		while (segments.length && segments[segments.length - 1].toLowerCase() !== 'admin') {
			segments.pop();
		}

		if (segments.length && segments[segments.length - 1].toLowerCase() === 'admin') {
			return `${segments.join('/')}/`;
		}

		return 'admin/';
	}

	function resolveAdminHref(href) {
		const value = String(href || '').trim();
		if (!value) {
			return '#';
		}

		if (/^(?:[a-z]+:|#|\?)/i.test(value)) {
			return value;
		}

		if (value.startsWith('/')) {
			return value;
		}

		return `${getAdminBasePath()}${value.replace(/^\.\//, '')}`;
	}

	function getCurrentPath() {
		const path = window.location.pathname || '';
		const match = path.match(/\/admin\/(.*)$/i);
		return normalize(match ? match[1] : path.split('/').pop() || 'dashboard.html');
	}

	function childIsActive(children, currentPath) {
		return Array.isArray(children) && children.some((child) => normalize(child.href) === currentPath);
	}

	function createChildLink(item, currentPath) {
		const active = normalize(item.href) === currentPath;
		return `<a class="admin-sidebar-child-link${active ? ' is-active' : ''}" href="${resolveAdminHref(item.href)}"${active ? ' aria-current="page"' : ''}><span class="admin-sidebar-child-dot" aria-hidden="true"></span><span>${item.label}</span></a>`;
	}

	function createNavItem(item, currentPath, index) {
		const directActive = normalize(item.href) === currentPath;
		const nestedActive = childIsActive(item.children, currentPath);
		const itemActive = directActive || nestedActive;

		if (!Array.isArray(item.children) || !item.children.length) {
			return `
				<a class="admin-sidebar-link${itemActive ? ' is-active' : ''}" href="${resolveAdminHref(item.href)}"${itemActive ? ' aria-current="page"' : ''}>
					<span class="admin-sidebar-icon">${item.icon || ''}</span>
					<span class="admin-sidebar-link-text">
						<span>${item.label}</span>
						<small>${item.description || ''}</small>
					</span>
				</a>
			`;
		}

		const sectionId = `sidebar-group-${index}`;

		return `
			<div class="admin-sidebar-branch">
				<div class="admin-sidebar-branch-header">
					<a class="admin-sidebar-link admin-sidebar-link--branch${itemActive ? ' is-active' : ''}" href="${resolveAdminHref(item.href)}"${directActive ? ' aria-current="page"' : ''}>
						<span class="admin-sidebar-icon">${item.icon || ''}</span>
						<span class="admin-sidebar-link-text">
							<span>${item.label}</span>
							<small>${item.description || ''}</small>
						</span>
					</a>
					<button class="admin-sidebar-expander${itemActive ? ' is-active' : ''}" type="button" aria-label="Toggle ${item.label} links" aria-expanded="false" aria-controls="${sectionId}">
						<span class="admin-sidebar-caret">&#8250;</span>
					</button>
				</div>
				<div class="admin-sidebar-children-wrap" id="${sectionId}" data-sidebar-panel>
					<div class="admin-sidebar-children">
						${item.children.map((child) => createChildLink(child, currentPath)).join('')}
					</div>
				</div>
			</div>
		`;
	}

	function renderSidebar(root) {
		const currentPath = getCurrentPath();
		const session = window.AdminAuthService && typeof window.AdminAuthService.getSession === 'function'
			? window.AdminAuthService.getSession()
			: null;
		const sessionEmail = session && session.email ? session.email : 'Admin access only';

		root.innerHTML = `
			<div class="admin-sidebar-brand">
				<div class="admin-sidebar-brand-mark" aria-hidden="true">BM</div>
				<div class="admin-sidebar-brand-copy">
					<span>Byose Market</span>
					<strong>Admin Navigation</strong>
					<small>System-wide navigation for all admin modules</small>
				</div>
			</div>
			<nav class="admin-sidebar-nav">
				${navigation.map((group) => `
					<section class="admin-sidebar-group">
						<p class="admin-sidebar-group-label">${group.group}</p>
						<div class="admin-sidebar-group-items">
							${group.items.map((item, itemIndex) => createNavItem(item, currentPath, `${normalize(group.group)}-${itemIndex}`)).join('')}
						</div>
					</section>
				`).join('')}
			</nav>
			<div class="admin-sidebar-footer">
				<span class="admin-sidebar-footer-label">Admin session</span>
				<strong>${sessionEmail}</strong>
				<small>Protected with backend token validation.</small>
				<button class="admin-sidebar-logout" type="button" data-admin-logout>Log out</button>
			</div>
		`;
	}

	function bindSidebarInteractions(root) {
		const buttons = Array.from(root.querySelectorAll('.admin-sidebar-expander'));
		const logoutButton = root.querySelector('[data-admin-logout]');

		function closeAllSections(exceptButton) {
			buttons.forEach((button) => {
				if (exceptButton && button === exceptButton) {
					return;
				}

				const controls = button.getAttribute('aria-controls');
				const panel = controls ? document.getElementById(controls) : null;
				button.setAttribute('aria-expanded', 'false');
				if (panel) {
					panel.classList.remove('is-open');
				}
			});
		}

		buttons.forEach((button) => {
			button.addEventListener('click', () => {
				const controls = button.getAttribute('aria-controls');
				const panel = controls ? document.getElementById(controls) : null;
				const isExpanded = button.getAttribute('aria-expanded') === 'true';

				closeAllSections(button);

				if (panel) {
					if (isExpanded) {
						button.setAttribute('aria-expanded', 'false');
						panel.classList.remove('is-open');
					} else {
						button.setAttribute('aria-expanded', 'true');
						panel.classList.add('is-open');
					}
				} else {
					button.setAttribute('aria-expanded', String(!isExpanded));
				}
			});
		});

		if (logoutButton && window.AdminAuthService && typeof window.AdminAuthService.logout === 'function') {
			logoutButton.addEventListener('click', () => {
				window.AdminAuthService.logout({ redirect: true });
			});
		}

		const activeButton = buttons.find((button) => button.classList.contains('is-active'));
		if (activeButton) {
			const controls = activeButton.getAttribute('aria-controls');
			const panel = controls ? document.getElementById(controls) : null;
			closeAllSections(activeButton);
			activeButton.setAttribute('aria-expanded', 'true');
			if (panel) {
				panel.classList.add('is-open');
			}
			return;
		}

		closeAllSections();
	}

	function setupResponsiveSidebar(root) {
		const toggle = document.querySelector('[data-sidebar-toggle]');
		const backdrop = document.querySelector('[data-sidebar-backdrop]');
		const desktopQuery = window.matchMedia('(min-width: 1024px)');

		function closeSidebar() {
			root.classList.remove('is-open');
			document.body.classList.remove('sidebar-open');
			if (toggle) {
				toggle.setAttribute('aria-expanded', 'false');
			}
			if (backdrop) {
				backdrop.hidden = true;
			}
		}

		function openSidebar() {
			if (desktopQuery.matches) {
				return;
			}

			root.classList.add('is-open');
			document.body.classList.add('sidebar-open');
			if (toggle) {
				toggle.setAttribute('aria-expanded', 'true');
			}
			if (backdrop) {
				backdrop.hidden = false;
			}
		}

		function syncDesktopState() {
			if (desktopQuery.matches) {
				root.classList.remove('is-open');
				document.body.classList.remove('sidebar-open');
				if (backdrop) {
					backdrop.hidden = true;
				}
				if (toggle) {
					toggle.setAttribute('aria-expanded', 'false');
				}
			}
		}

		if (toggle) {
			toggle.addEventListener('click', () => {
				if (root.classList.contains('is-open')) {
					closeSidebar();
				} else {
					openSidebar();
				}
			});
		}

		if (backdrop) {
			backdrop.addEventListener('click', closeSidebar);
		}

		root.querySelectorAll('a').forEach((link) => {
			link.addEventListener('click', () => {
				if (!desktopQuery.matches) {
					closeSidebar();
				}
			});
		});

		window.addEventListener('keydown', (event) => {
			if (event.key === 'Escape') {
				closeSidebar();
			}
		});

		if (typeof desktopQuery.addEventListener === 'function') {
			desktopQuery.addEventListener('change', syncDesktopState);
		} else if (typeof desktopQuery.addListener === 'function') {
			desktopQuery.addListener(syncDesktopState);
		}

		syncDesktopState();
	}

	function initAdminSidebar() {
		const root = document.querySelector('[data-sidebar-root]');
		if (!root || root.dataset.sidebarMounted === 'true') {
			return;
		}

		renderSidebar(root);
		bindSidebarInteractions(root);
		setupResponsiveSidebar(root);
		root.dataset.sidebarMounted = 'true';
		initialized = true;
	}

	function scheduleSidebarInit() {
		if (initialized) {
			return;
		}

		if (document.readyState === 'loading') {
			document.addEventListener('DOMContentLoaded', initAdminSidebar, { once: true });
			return;
		}

		initAdminSidebar();
	}

	window.AdminSidebar = {
		init: initAdminSidebar,
		navigation,
		resolveAdminHref
	};

	scheduleSidebarInit();
})();
