// ===============================
// 🔥 BOTTOM NAV COMPONENT
// ===============================

// ===============================
// 🧱 CREATE NAV
// ===============================
function loadBottomNav() {

  const container = document.getElementById("bottom-nav");

  if (!container) return;

  container.innerHTML = `
    <div class="bottom-nav-container">

      <div class="nav-item" data-page="home">
        <i class="fa-solid fa-house"></i>
        <span>Home</span>
      </div>

      <div class="nav-item" data-page="cart">
        <i class="fa-solid fa-cart-shopping"></i>
        <span>Cart</span>
      </div>

      <div class="nav-item" data-page="orders">
        <i class="fa-solid fa-box"></i>
        <span>Orders</span>
      </div>

      <div class="nav-item active" data-page="account">
        <i class="fa-solid fa-user"></i>
        <span>Account</span>
      </div>

    </div>
  `;
}

function sitePath(target) {
  return '../' + String(target || '').replace(/^\/+/, '');
}

// ===============================
// 🖱️ EVENTS
// ===============================
function initBottomNavEvents() {

  const items = document.querySelectorAll(".nav-item");

  items.forEach(item => {

    item.addEventListener("click", () => {

      const page = item.getAttribute("data-page");

      // remove active
      items.forEach(i => i.classList.remove("active"));
      item.classList.add("active");

      // navigation
      switch (page) {
        case "home":
          window.location.href = sitePath('index.html');
          break;

        case "cart":
          window.location.href = sitePath('cart.html');
          break;

        case "orders":
          alert("Orders page coming soon 📦");
          break;

        case "account":
          // delegate to global account handler to ensure consistent auth logic
          if (typeof handleAccountClick === 'function') handleAccountClick();
          else if (typeof window.handleAccountClick === 'function') window.handleAccountClick();
          else window.location.href = sitePath('login.html');
          break;
      }

    });

  });
}

// ===============================
// 🚀 INIT
// ===============================
function initBottomNavComponent() {
  loadBottomNav();
  initBottomNavEvents();
}