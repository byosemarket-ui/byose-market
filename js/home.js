/* ========================================
   HOME PAGE LOGIC
   ======================================== */

function getCentralizedCatalog() {
  const service = window.ByoseProductCatalog;
  if (service && typeof service.getStorefrontCatalog === 'function') {
    return service.getStorefrontCatalog();
  }

  return Array.isArray(window.products) ? window.products : [];
}

const ProductsDB = {
  getFeatured() {
    return getCentralizedCatalog().filter(product => product && (product.highlightTag || product.badge || '').toLowerCase() === 'featured' || String(product.priority || '').toLowerCase() === 'top');
  },
  getTopRated() {
    return getCentralizedCatalog().slice().sort((left, right) => Number(right.rating || 0) - Number(left.rating || 0));
  },
  getById(productId) {
    return getCentralizedCatalog().find(product => Number(product.id) === Number(productId)) || null;
  },
  getDiscount(price, oldPrice) {
    const current = Number(price || 0);
    const previous = Number(oldPrice || 0);
    if (previous <= current || previous <= 0) {
      return 0;
    }
    return Math.round(((previous - current) / previous) * 100);
  }
};

document.addEventListener('DOMContentLoaded', () => {
  loadFeaturedProducts();
  loadTopRatedProducts();
  setupNewsletter();
});

/**
 * LOAD FEATURED PRODUCTS
 */
function loadFeaturedProducts() {
  const container = document.getElementById('featuredProducts');
  if (!container) return;

  const products = ProductsDB.getFeatured();
  container.innerHTML = products.map(product => createProductCardHTML(product)).join('');
  setupProductCards();
}

/**
 * LOAD TOP RATED PRODUCTS
 */
function loadTopRatedProducts() {
  const container = document.getElementById('topRatedProducts');
  if (!container) return;

  const products = ProductsDB.getTopRated();
  container.innerHTML = products.map(product => createProductCardHTML(product)).join('');
  setupProductCards();
}

/**
 * CREATE PRODUCT CARD HTML
 */
function createProductCardHTML(product) {
  const discount = ProductsDB.getDiscount(product.price, product.originalPrice);
  
  return `
    <div class="product-card" data-product-id="${product.id}">
      <div class="product-image">
        <img src="${product.image}" alt="${product.name}" loading="lazy">
        ${product.badge ? `<span class="product-badge ${product.badge}">${product.badge.toUpperCase()}</span>` : ''}
        <button class="product-wishlist" data-product-id="${product.id}" aria-label="Add to wishlist">
          <i class="far fa-heart"></i>
        </button>
      </div>
      <div class="product-content">
        <h3 class="product-name">${product.name}</h3>
        <div class="product-rating">
          <span class="product-stars">${Util.getStarDisplay(product.rating)}</span>
          <span>(${product.rating})</span>
          <span>• Sold ${product.sold}</span>
        </div>
        <div class="product-price">
          <span class="product-price-current">${Util.formatPrice(product.price)}</span>
          <span class="product-price-old">${Util.formatPrice(product.originalPrice)}</span>
          <span class="product-discount">-${discount}%</span>
        </div>
        <div class="product-actions">
          <button class="btn btn-primary btn-add-cart" data-product-id="${product.id}">
            <i class="fas fa-shopping-cart"></i> Add
          </button>
          <button class="btn-icon btn-quick-view" data-product-id="${product.id}" aria-label="Quick view">
            <i class="fas fa-eye"></i>
          </button>
        </div>
      </div>
    </div>
  `;
}

/**
 * SETUP PRODUCT CARD INTERACTIONS
 */
function setupProductCards() {
  // CLICK ON PRODUCT CARD TO VIEW DETAILS
  document.querySelectorAll('.product-card').forEach(card => {
    card.addEventListener('click', (e) => {
      // Don't navigate if clicking on buttons
      if (e.target.closest('.product-wishlist') || e.target.closest('.btn-add-cart') || e.target.closest('.btn-quick-view')) {
        return;
      }
      const productId = card.dataset.productId;
      window.location.href = `product-details.html?id=${productId}`;
    });
  });

  // ADD TO CART BUTTON
  document.querySelectorAll('.btn-add-cart').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const productId = btn.dataset.productId;
      const product = ProductsDB.getById(productId);
      if (product) {
        Cart.addItem({
          id: product.id,
          name: product.name,
          price: product.price,
          image: product.image,
          qty: 1,
        });
      }
    });
  });

  // QUICK VIEW BUTTON
  document.querySelectorAll('.btn-quick-view').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const productId = btn.dataset.productId;
      window.location.href = `product-details.html?id=${productId}`;
    });
  });

  // WISHLIST BUTTON
  document.querySelectorAll('.product-wishlist').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const productId = btn.dataset.productId;
      const product = ProductsDB.getById(productId);
      const icon = btn.querySelector('i');

      if (product) {
        const wishlist = Util.getFromStorage('byose_market_wishlist', []);
        const exists = wishlist.some(item => item.id === productId);

        if (exists) {
          // Remove from wishlist
          const newWishlist = wishlist.filter(item => item.id !== productId);
          Util.setToStorage('byose_market_wishlist', newWishlist);
          icon.classList.remove('fas');
          icon.classList.add('far');
          Util.showInfo('Removed from wishlist');
        } else {
          // Add to wishlist
          wishlist.push({
            id: product.id,
            name: product.name,
            price: product.price,
            image: product.image,
          });
          Util.setToStorage('byose_market_wishlist', wishlist);
          icon.classList.remove('far');
          icon.classList.add('fas');
          Util.showSuccess('Added to wishlist!');
        }

        // Update badge
        updateWishlistBadge();
      }
    });
  });
}

/**
 * SETUP NEWSLETTER FORM
 */
function setupNewsletter() {
  const form = document.getElementById('newsletterForm');
  if (!form) return;

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const email = form.querySelector('input[type="email"]').value;

    if (Util.isValidEmail(email)) {
      // Save newsletter subscription
      const subscribers = Util.getFromStorage('byose_market_newsletter_subscribers', []);
      if (!subscribers.includes(email)) {
        subscribers.push(email);
        Util.setToStorage('byose_market_newsletter_subscribers', subscribers);
      }

      Util.showSuccess('Thank you for subscribing!');
      form.reset();
    } else {
      Util.showError('Please enter a valid email address');
    }
  });
}

// Call update wishlist badge on page load
document.addEventListener('DOMContentLoaded', updateWishlistBadge);
