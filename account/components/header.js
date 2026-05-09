// ===============================
// 🔥 HEADER COMPONENT
// ===============================

// ===============================
// 👤 GET USER DATA
// ===============================
function getUserData() {
  let user = {};
  if (typeof window.getCurrentUser === 'function') {
    try { user = window.getCurrentUser() || {}; } catch (e) { user = {}; }
  } else {
    try { user = JSON.parse(localStorage.getItem("bm_user")) || {}; } catch (e) { user = {}; }
  }
  return {
    name: user.name || "Guest User",
    avatar: user.avatar || user.image || ""
  };
}

// ===============================
// 🧱 CREATE HEADER
// ===============================
function loadHeader() {

  const container = document.getElementById("account-header");

  if (!container) return;

  const user = getUserData();

  container.innerHTML = `
    <div class="header-left">

      <div class="profile-wrapper" id="profileUpload">
        ${ user.avatar ? `<img src="${user.avatar}" alt="profile">` : `<i class="fa-solid fa-user"></i>` }
      </div>

      <div class="user-info">
        <h2>${user.name}</h2>
        <p>Welcome back 👋</p>
      </div>

    </div>

    <div class="header-right">

      <div class="icon-btn" id="notificationBtn">
        <i class="fa-solid fa-bell"></i>
        <span id="notificationCount" class="badge">0</span>
      </div>

      <div class="icon-btn" id="settingsBtn">
        <i class="fa-solid fa-gear"></i>
      </div>

    </div>
  `;
}

// ===============================
// 📸 IMAGE UPLOAD
// ===============================
function initProfileUpload() {

  const wrapper = document.getElementById("profileUpload");

  if (!wrapper) return;

  wrapper.addEventListener("click", () => {

    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";

    input.onchange = (e) => {
      const file = e.target.files[0];

      if (!file) return;

      const reader = new FileReader();

      reader.onload = function () {
        const imageData = reader.result;

        let user = {};
        if (window.authService && typeof window.authService.getCurrentUser === 'function') {
          try { user = window.authService.getCurrentUser() || {}; } catch (e) { user = {}; }
        } else if (typeof window.getCurrentUser === 'function') {
          try { user = window.getCurrentUser() || {}; } catch (e) { user = {}; }
        }
        user.avatar = imageData;
        if (window.authService && typeof window.authService.setCurrentUser === 'function') {
          try { window.authService.setCurrentUser(user); } catch (e) { console.error(e); }
        } else if (typeof window.setCurrentUser === 'function') {
          try { window.setCurrentUser(user); } catch (e) { console.error(e); }
        }

        // reload header
        loadHeader();
        initProfileUpload();
      };

      reader.readAsDataURL(file);
    };

    input.click();
  });
}

// ===============================
// 🚀 INIT
// ===============================
function initHeader() {
  loadHeader();
  initProfileUpload();
}