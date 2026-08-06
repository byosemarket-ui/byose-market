import { badge, emptyState, formatDate, openModal, table } from "../../components/ui.js";
import {
  createHeroSlide,
  deleteHeroSlide,
  getHeroSlides,
  updateHeroSlide
} from "../../services/admin-data.service.js";
import { HERO_BUCKET, uploadWithRetry } from "../../../../services/uploadService.js";
import { mountHeroSlideForm, renderHeroSlideFormMarkup } from "./form.js";
import {
  escapeHtml,
  getSlideId,
  resolveImageUrl,
  validateHeroImageFile
} from "./utils.js";

const PAGE_SIZE = 8;
const MAX_PAGE_FETCH = 200;

function statusBadge(status) {
  const normalized = String(status || "active").toLowerCase() === "inactive" ? "inactive" : "active";
  return badge(normalized === "active" ? "Active" : "Inactive", normalized === "active" ? "success" : "neutral");
}

function sortSlides(slides, sortKey) {
  const list = [...slides];
  const key = String(sortKey || "order-asc").toLowerCase();

  list.sort((left, right) => {
    if (key === "order-desc") {
      return Number(right.displayOrder || 0) - Number(left.displayOrder || 0);
    }
    if (key === "newest") {
      return new Date(right.createdAt || 0).getTime() - new Date(left.createdAt || 0).getTime();
    }
    if (key === "oldest") {
      return new Date(left.createdAt || 0).getTime() - new Date(right.createdAt || 0).getTime();
    }
    if (key === "title-asc") {
      return String(left.title || "").localeCompare(String(right.title || ""));
    }
    if (key === "title-desc") {
      return String(right.title || "").localeCompare(String(left.title || ""));
    }
    return Number(left.displayOrder || 0) - Number(right.displayOrder || 0);
  });

  return list;
}

function filterSlides(slides, query, status) {
  const normalizedQuery = String(query || "").trim().toLowerCase();
  const normalizedStatus = String(status || "").trim().toLowerCase();

  return slides.filter((slide) => {
    const matchesStatus = !normalizedStatus || String(slide.status || "active").toLowerCase() === normalizedStatus;
    if (!matchesStatus) {
      return false;
    }
    if (!normalizedQuery) {
      return true;
    }

    const haystack = [
      slide.id,
      slide.slideId,
      slide.title,
      slide.subtitle,
      slide.buttonText,
      slide.buttonLink
    ].join(" ").toLowerCase();

    return haystack.includes(normalizedQuery);
  });
}

function showFeedback(container, message, tone = "success") {
  const host = container.querySelector("[data-hs-feedback]");
  if (!host) {
    return;
  }

  const safeTone = tone === "error" ? "error" : tone === "warn" ? "warn" : "success";
  host.innerHTML = `<div class="hs-feedback hs-feedback-${safeTone}" role="status">${escapeHtml(message)}</div>`;
  window.clearTimeout(showFeedback._timer);
  showFeedback._timer = window.setTimeout(() => {
    if (host.isConnected) {
      host.innerHTML = "";
    }
  }, 4200);
}

function renderPreviewCell(slide) {
  const image = resolveImageUrl(slide);
  if (!image) {
    return `<div class="hs-preview hs-preview-empty" aria-hidden="true">No image</div>`;
  }

  return `<div class="hs-preview"><img src="${escapeHtml(image)}" alt="" loading="lazy" /></div>`;
}

function renderActionButtons(slide) {
  const id = escapeHtml(getSlideId(slide));
  const isActive = String(slide.status || "active").toLowerCase() === "active";
  const toggleLabel = isActive ? "Disable" : "Enable";
  const nextStatus = isActive ? "inactive" : "active";

  return `
    <div class="hs-row-actions">
      <button type="button" class="pm-btn pm-btn-ghost pm-btn-sm" data-hs-action="view" data-slide-id="${id}">View</button>
      <button type="button" class="pm-btn pm-btn-ghost pm-btn-sm" data-hs-action="edit" data-slide-id="${id}">Edit</button>
      <button type="button" class="pm-btn pm-btn-ghost pm-btn-sm" data-hs-action="replace-image" data-slide-id="${id}">Replace Image</button>
      <button type="button" class="pm-btn pm-btn-secondary pm-btn-sm" data-hs-action="toggle" data-slide-id="${id}" data-next-status="${nextStatus}">${toggleLabel}</button>
      <button type="button" class="pm-btn pm-btn-danger pm-btn-sm" data-hs-action="delete" data-slide-id="${id}">Delete</button>
    </div>
  `;
}

function renderTable(slides) {
  if (!slides.length) {
    return emptyState("No hero slides match your search or filters.");
  }

  const rows = slides.map((slide) => [
    { html: renderPreviewCell(slide) },
    slide.title || "Untitled slide",
    slide.subtitle || "-",
    slide.buttonText || "-",
    slide.buttonLink || "-",
    String(slide.displayOrder ?? 0),
    { html: statusBadge(slide.status) },
    formatDate(slide.createdAt),
    formatDate(slide.updatedAt),
    { html: renderActionButtons(slide) }
  ]);

  return table(
    ["Preview", "Title", "Subtitle", "Button Text", "Button Link", "Order", "Status", "Created", "Updated", "Actions"],
    rows
  );
}

function renderPagination(page, totalPages, totalItems) {
  if (totalItems <= PAGE_SIZE) {
    return "";
  }

  return `
    <div class="hs-pagination">
      <button type="button" class="pm-btn pm-btn-ghost" data-hs-page="prev" ${page <= 1 ? "disabled" : ""}>Previous</button>
      <span>Page ${page} of ${totalPages}</span>
      <button type="button" class="pm-btn pm-btn-ghost" data-hs-page="next" ${page >= totalPages ? "disabled" : ""}>Next</button>
    </div>
  `;
}

function renderViewDetails(slide) {
  const image = resolveImageUrl(slide);
  return `
    <div class="hs-view">
      <div class="hs-view-media">
        ${image
          ? `<img src="${escapeHtml(image)}" alt="${escapeHtml(slide.title || "Hero slide")}" />`
          : `<div class="hs-preview hs-preview-empty">No image uploaded</div>`}
      </div>
      <dl class="hs-view-meta">
        <div><dt>Title</dt><dd>${escapeHtml(slide.title || "-")}</dd></div>
        <div><dt>Subtitle</dt><dd>${escapeHtml(slide.subtitle || "-")}</dd></div>
        <div><dt>Button Text</dt><dd>${escapeHtml(slide.buttonText || "-")}</dd></div>
        <div><dt>Button Link</dt><dd>${escapeHtml(slide.buttonLink || "-")}</dd></div>
        <div><dt>Display Order</dt><dd>${escapeHtml(String(slide.displayOrder ?? 0))}</dd></div>
        <div><dt>Status</dt><dd>${statusBadge(slide.status)}</dd></div>
        <div><dt>Created</dt><dd>${escapeHtml(formatDate(slide.createdAt))}</dd></div>
        <div><dt>Updated</dt><dd>${escapeHtml(formatDate(slide.updatedAt))}</dd></div>
        <div><dt>Slide ID</dt><dd><code>${escapeHtml(getSlideId(slide))}</code></dd></div>
      </dl>
    </div>
  `;
}

async function uploadSlideImage(file, previousPath = "") {
  const uploaded = await uploadWithRetry(file, {
    bucket: HERO_BUCKET,
    cleanupPaths: previousPath ? [previousPath] : [],
    progressLabel: "Uploading hero slide image..."
  });

  return {
    imageUrl: uploaded.publicUrl || uploaded.url || "",
    imagePath: uploaded.storagePath || uploaded.path || ""
  };
}

function buildShellMarkup(stats = {}) {
  return `
    <div class="pm-shell hs-shell">
      <section class="pm-hero card">
        <div class="pm-hero-copy">
          <p class="pm-kicker">Website Management</p>
          <h1>Hero Slider Management</h1>
          <p>Manage the homepage hero carousel slides, imagery, calls to action, display order, and publish status.</p>
        </div>
        <div class="pm-hero-actions">
          <button type="button" class="pm-btn pm-btn-primary" data-hs-action="create">Add New Slide</button>
        </div>
      </section>

      <div data-hs-feedback></div>

      <section class="pm-stats">
        <article class="pm-stat card"><span>Total Slides</span><strong data-hs-stat="total">${stats.total || 0}</strong></article>
        <article class="pm-stat card"><span>Active</span><strong data-hs-stat="active">${stats.active || 0}</strong></article>
        <article class="pm-stat card"><span>Inactive</span><strong data-hs-stat="inactive">${stats.inactive || 0}</strong></article>
      </section>

      <section class="card pm-panel">
        <header class="pm-panel-head">
          <div>
            <h2>All Hero Slides</h2>
            <p data-hs-summary>Loading slides from the database...</p>
          </div>
          <button type="button" class="pm-btn pm-btn-secondary" data-hs-action="create">Add New Slide</button>
        </header>
        <div class="hs-toolbar" data-hs-toolbar></div>
        <div class="pm-panel-body" data-hs-table-host>
          <div class="state-block">Loading...</div>
        </div>
        <div data-hs-pagination></div>
      </section>
      <input type="file" accept="image/jpeg,image/jpg,image/png,image/webp,.jpg,.jpeg,.png,.webp" hidden data-hs-replace-input />
    </div>
  `;
}

function renderToolbar(host, state, onChange) {
  host.innerHTML = `
    <input type="search" class="input" data-hs-search placeholder="Search title, subtitle, button, link, or ID" value="${escapeHtml(state.query)}" />
    <select class="input" data-hs-status>
      <option value="">All statuses</option>
      <option value="active"${state.status === "active" ? " selected" : ""}>Active</option>
      <option value="inactive"${state.status === "inactive" ? " selected" : ""}>Inactive</option>
    </select>
    <select class="input" data-hs-sort>
      <option value="order-asc"${state.sort === "order-asc" ? " selected" : ""}>Order: Low to High</option>
      <option value="order-desc"${state.sort === "order-desc" ? " selected" : ""}>Order: High to Low</option>
      <option value="newest"${state.sort === "newest" ? " selected" : ""}>Newest first</option>
      <option value="oldest"${state.sort === "oldest" ? " selected" : ""}>Oldest first</option>
      <option value="title-asc"${state.sort === "title-asc" ? " selected" : ""}>Title A–Z</option>
      <option value="title-desc"${state.sort === "title-desc" ? " selected" : ""}>Title Z–A</option>
    </select>
    <button type="button" class="pm-btn pm-btn-secondary" data-hs-refresh>Refresh</button>
  `;

  host.querySelector("[data-hs-search]").addEventListener("input", (event) => {
    onChange({ query: event.target.value, page: 1 });
  });
  host.querySelector("[data-hs-status]").addEventListener("change", (event) => {
    onChange({ status: event.target.value, page: 1 });
  });
  host.querySelector("[data-hs-sort]").addEventListener("change", (event) => {
    onChange({ sort: event.target.value, page: 1 });
  });
  host.querySelector("[data-hs-refresh]").addEventListener("click", () => {
    onChange({ force: true });
  });
}

export async function renderHeroSlider(container) {
  let state = {
    query: "",
    status: "",
    sort: "order-asc",
    page: 1,
    force: false
  };
  let slides = [];
  let hasLoaded = false;
  let replaceTargetId = "";
  let disposeForm = null;

  container.innerHTML = buildShellMarkup();

  async function loadSlides() {
    slides = await getHeroSlides({
      force: state.force || !hasLoaded,
      allowCacheFallback: true,
      emit: false,
      limit: MAX_PAGE_FETCH
    });
    state.force = false;
    hasLoaded = true;
  }

  function getVisibleSlides() {
    return sortSlides(filterSlides(slides, state.query, state.status), state.sort);
  }

  function updateStats() {
    const active = slides.filter((slide) => String(slide.status || "active").toLowerCase() === "active").length;
    const inactive = slides.length - active;
    const totalNode = container.querySelector('[data-hs-stat="total"]');
    const activeNode = container.querySelector('[data-hs-stat="active"]');
    const inactiveNode = container.querySelector('[data-hs-stat="inactive"]');
    if (totalNode) totalNode.textContent = String(slides.length);
    if (activeNode) activeNode.textContent = String(active);
    if (inactiveNode) inactiveNode.textContent = String(inactive);
  }

  function paintTable() {
    const filtered = getVisibleSlides();
    const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
    if (state.page > totalPages) {
      state.page = totalPages;
    }

    const start = (state.page - 1) * PAGE_SIZE;
    const pageItems = filtered.slice(start, start + PAGE_SIZE);
    const tableHost = container.querySelector("[data-hs-table-host]");
    const paginationHost = container.querySelector("[data-hs-pagination]");
    const summary = container.querySelector("[data-hs-summary]");

    if (!slides.length) {
      tableHost.innerHTML = emptyState("No hero slides yet. Create your first slide to power the homepage carousel.");
      paginationHost.innerHTML = "";
      if (summary) {
        summary.textContent = "Database is ready. Add the first homepage hero slide.";
      }
      return;
    }

    tableHost.innerHTML = renderTable(pageItems);
    paginationHost.innerHTML = renderPagination(state.page, totalPages, filtered.length);
    if (summary) {
      summary.textContent = `Showing ${pageItems.length} of ${filtered.length} filtered slides (${slides.length} total).`;
    }
  }

  async function refresh(options = {}) {
    state = { ...state, ...options };
    try {
      if (state.force || !hasLoaded) {
        await loadSlides();
      }
      updateStats();
      paintTable();
    } catch (error) {
      const tableHost = container.querySelector("[data-hs-table-host]");
      if (tableHost) {
        tableHost.innerHTML = `<div class="state-block state-block-error"><p>${escapeHtml(error?.message || "Unable to load hero slides.")}</p></div>`;
      }
      showFeedback(container, error?.message || "Unable to load hero slides.", "error");
    }
  }

  function openSlideForm(mode, slide = null) {
    if (typeof disposeForm === "function") {
      disposeForm();
      disposeForm = null;
    }

    const title = mode === "edit" ? "Edit Hero Slide" : "Add New Hero Slide";
    openModal(title, renderHeroSlideFormMarkup(slide, mode));
    const form = document.querySelector(`[data-hs-form="${mode}"]`);

    disposeForm = mountHeroSlideForm(form, {
      slide,
      getExistingSlides: () => slides,
      onCreate: async (payload) => createHeroSlide(payload),
      onUpdate: async (slideId, payload) => updateHeroSlide(slideId, payload),
      onCancel: () => {
        const modal = document.getElementById("appModal");
        if (modal) modal.hidden = true;
      },
      onError: (error) => {
        showFeedback(container, error?.message || "Unable to save the slide.", "error");
      },
      onSuccess: async (savedSlide, meta) => {
        const message = meta.mode === "edit"
          ? "Hero slide updated successfully."
          : "Hero slide created successfully.";
        showFeedback(container, message);
        await refresh({ force: true, page: meta.continueEditing ? state.page : 1 });

        if (meta.continueEditing && savedSlide) {
          const index = slides.findIndex((entry) => getSlideId(entry) === getSlideId(savedSlide));
          if (index >= 0) {
            slides[index] = savedSlide;
          } else {
            slides = [savedSlide, ...slides];
          }
        }
      }
    });
  }

  function openViewModal(slide) {
    openModal("Hero Slide Details", renderViewDetails(slide));
  }

  async function replaceImage(slide, file) {
    if (!file) {
      return;
    }

    const validationError = validateHeroImageFile(file);
    if (validationError) {
      showFeedback(container, validationError, "error");
      return;
    }

    try {
      showFeedback(container, "Uploading replacement image...", "warn");
      const media = await uploadSlideImage(file, slide.imagePath || "");
      await updateHeroSlide(getSlideId(slide), {
        imageUrl: media.imageUrl,
        imagePath: media.imagePath
      });
      showFeedback(container, "Hero slide image replaced successfully.");
      await refresh({ force: true });
    } catch (error) {
      showFeedback(container, error?.message || "Unable to replace the slide image.", "error");
    }
  }

  const toolbarHost = container.querySelector("[data-hs-toolbar]");
  renderToolbar(toolbarHost, state, async (next) => {
    await refresh(next);
  });

  const replaceInput = container.querySelector("[data-hs-replace-input]");
  replaceInput.addEventListener("change", async () => {
    const file = replaceInput.files?.[0] || null;
    const slide = slides.find((entry) => getSlideId(entry) === replaceTargetId);
    replaceInput.value = "";
    replaceTargetId = "";
    if (slide && file) {
      await replaceImage(slide, file);
    }
  });

  container.addEventListener("click", async (event) => {
    const createButton = event.target.closest("[data-hs-action='create']");
    if (createButton) {
      openSlideForm("create");
      return;
    }

    const pageButton = event.target.closest("[data-hs-page]");
    if (pageButton) {
      const direction = pageButton.getAttribute("data-hs-page");
      const nextPage = direction === "next" ? state.page + 1 : state.page - 1;
      await refresh({ page: Math.max(1, nextPage) });
      return;
    }

    const actionButton = event.target.closest("[data-hs-action][data-slide-id]");
    if (!actionButton) {
      return;
    }

    const slideId = actionButton.getAttribute("data-slide-id");
    const action = actionButton.getAttribute("data-hs-action");
    const slide = slides.find((entry) => getSlideId(entry) === slideId);
    if (!slide) {
      showFeedback(container, "That slide could not be found. Refresh and try again.", "error");
      return;
    }

    if (action === "view") {
      openViewModal(slide);
      return;
    }

    if (action === "edit") {
      openSlideForm("edit", slide);
      return;
    }

    if (action === "replace-image") {
      replaceTargetId = slideId;
      replaceInput.click();
      return;
    }

    if (action === "toggle") {
      const nextStatus = actionButton.getAttribute("data-next-status") || "inactive";
      actionButton.disabled = true;
      try {
        await updateHeroSlide(slideId, { status: nextStatus });
        showFeedback(container, nextStatus === "active" ? "Slide enabled successfully." : "Slide disabled successfully.");
        await refresh({ force: true });
      } catch (error) {
        actionButton.disabled = false;
        showFeedback(container, error?.message || "Unable to update slide status.", "error");
      }
      return;
    }

    if (action === "delete") {
      const confirmed = window.confirm(`Delete "${slide.title || "this slide"}" from the homepage hero slider? This cannot be undone.`);
      if (!confirmed) {
        return;
      }

      actionButton.disabled = true;
      try {
        await deleteHeroSlide(slideId);
        showFeedback(container, "Hero slide deleted successfully.");
        await refresh({ force: true, page: 1 });
      } catch (error) {
        actionButton.disabled = false;
        showFeedback(container, error?.message || "Unable to delete the slide.", "error");
      }
    }
  });

  await refresh({ force: true });
}
