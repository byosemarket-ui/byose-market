/* ========================================
   PRODUCT DETAILS PAGE LOGIC
   ======================================== */

const ProductDetail = {
  product: null,
  selectedColor: null,
  selectedSize: null,
  quantity: 1,

  startDirectCheckout() {
    if (!this.selectedColor || !this.selectedSize) {
      Util.showWarning('Please select color and size');
      return;
    }

    const directItem = {
      id: this.product.id,
      productId: this.product.id,
      name: this.product.name,
      price: this.product.price,
      image: this.product.image,
      img: this.product.image,
      color: this.selectedColor,
      size: this.selectedSize,
      qty: this.quantity,
      total: this.product.price * this.quantity,
    };

    window.ByoseStorefrontSync?.writeStateByKey?.('byose_direct_checkout', directItem);
    window.ByoseStorefrontSync?.removeStateByKey?.('byose_checkout_draft_v1');
    window.ByoseStorefrontSync?.removeStateByKey?.('byose_checkout_confirmation_v1');
    window.location.href = 'orders/shipping.html';
  },

  init() {
    const productId = Util.getUrlParam('id') || 'product1';
    this.loadProduct(productId);
  },

  loadProduct(productId) {
    this.product = ProductsDB.getById(productId);

    if (!this.product) {
      document.body.innerHTML = '<div style="text-align: center; padding: 40px;"><h2>Product not found</h2><a href="shop.html" class="btn btn-primary">Back to Shop</a></div>';
      return;
    }

    this.renderProduct();
    this.setupEventListeners();
    this.loadRelatedProducts();
    updateWishlistBadge();
  },

  renderProduct() {
    const product = this.product;

    // BREADCRUMB
    document.getElementById('breadcrumbProduct').textContent = product.name;

    // PRODUCT NAME & HEADER
    document.getElementById('productName').textContent = product.name;
    document.title = `${product.name} - Byose Market`;

    // RATING
    const discount = ProductsDB.getDiscount(product.price, product.originalPrice);
    document.getElementById('ratingStars').textContent = Util.getStarDisplay(product.rating);
    document.getElementById('ratingCount').textContent = `(${product.rating})`;
    document.getElementById('soldCount').textContent = `• Sold ${product.sold}`;

    // PRICES
    document.getElementById('currentPrice').textContent = Util.formatPrice(product.price);
    document.getElementById('originalPrice').textContent = Util.formatPrice(product.originalPrice);
    document.getElementById('discountBadge').textContent = `-${discount}%`;

    // DESCRIPTIONS
    document.getElementById('shortDesc').textContent = product.shortDesc || product.description;
    document.getElementById('fullDesc').innerHTML = product.description || 'No description available';

    // IMAGE GALLERY
    this.renderGallery();

    // OPTIONS
    this.renderColorOptions();
    this.renderSizeOptions();

    // SPECIFICATIONS TABLE
    this.renderSpecifications();
  },

  renderGallery() {
    const mainImage = document.getElementById('mainImage');
    const thumbnailsContainer = document.getElementById('thumbnails');

    // Set main image
    mainImage.src = this.product.image;
    mainImage.alt = this.product.name;

    // Render thumbnails
    const images = this.product.images || [this.product.image];
    thumbnailsContainer.innerHTML = images.map((img, index) => `
      <div class="thumbnail ${index === 0 ? 'active' : ''}" data-image="${img}">
        <img src="${img}" alt="Product ${index + 1}">
      </div>
    `).join('');

    // Thumbnail click handlers
    document.querySelectorAll('.thumbnail').forEach(thumb => {
      thumb.addEventListener('click', (e) => {
        document.querySelectorAll('.thumbnail').forEach(t => t.classList.remove('active'));
        thumb.classList.add('active');
        mainImage.src = thumb.dataset.image;
      });
    });
  },

  renderColorOptions() {
    const container = document.getElementById('colorOptions');
    const colors = this.product.colors || ['Default'];

    container.innerHTML = colors.map(color => `
      <button class="color-option" data-color="${color}">
        ${color}
      </button>
    `).join('');

    // Color selection handlers
    document.querySelectorAll('.color-option').forEach((btn, index) => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.color-option').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.selectedColor = btn.dataset.color;
      });

      // Auto-select first color
      if (index === 0) {
        btn.click();
      }
    });
  },

  renderSizeOptions() {
    const container = document.getElementById('sizeOptions');
    const sizes = this.product.sizes || ['One Size'];

    container.innerHTML = sizes.map(size => `
      <button class="size-option" data-size="${size}">
        ${size}
      </button>
    `).join('');

    // Size selection handlers
    document.querySelectorAll('.size-option').forEach((btn, index) => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.size-option').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.selectedSize = btn.dataset.size;
      });

      // Auto-select first size
      if (index === 0) {
        btn.click();
      }
    });
  },

  renderSpecifications() {
    const table = document.getElementById('specsTable');

    const specs = [
      { label: 'Product ID', value: this.product.id },
      { label: 'Category', value: this.product.category },
      { label: 'Price', value: Util.formatPrice(this.product.price) },
      { label: 'Rating', value: `${this.product.rating} / 5.0` },
      { label: 'Sold', value: `${this.product.sold} units` },
      { label: 'In Stock', value: this.product.inStock ? 'Yes' : 'No' },
    ];

    table.innerHTML = specs.map(spec => `
      <tr>
        <th>${spec.label}</th>
        <td>${spec.value}</td>
      </tr>
    `).join('');
  },

  setupEventListeners() {
    // QUANTITY CONTROLS
    const qtyInput = document.getElementById('qtyInput');
    const qtyMinus = document.getElementById('qtyMinus');
    const qtyPlus = document.getElementById('qtyPlus');

    qtyMinus.addEventListener('click', () => {
      this.quantity = Math.max(1, this.quantity - 1);
      qtyInput.value = this.quantity;
    });

    qtyPlus.addEventListener('click', () => {
      this.quantity = this.quantity + 1;
      qtyInput.value = this.quantity;
    });

    qtyInput.addEventListener('change', () => {
      this.quantity = Math.max(1, parseInt(qtyInput.value) || 1);
      qtyInput.value = this.quantity;
    });

    // ADD TO CART
    document.getElementById('addToCartBtn').addEventListener('click', () => {
      this.addToCart();
    });

    // BUY NOW
    document.getElementById('buyNowBtn').addEventListener('click', () => {
      this.startDirectCheckout();
    });

    // ADD TO WISHLIST
    document.getElementById('addWishlistBtn').addEventListener('click', () => {
      this.toggleWishlist();
    });

    // TABS
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const tabName = btn.dataset.tab;
        this.switchTab(tabName);
      });
    });

    // Auto-switch to first tab
    this.switchTab('description');
  },

  addToCart() {
    if (!this.selectedColor || !this.selectedSize) {
      Util.showWarning('Please select color and size');
      return;
    }

    const cartItem = {
      id: this.product.id,
      name: this.product.name,
      price: this.product.price,
      image: this.product.image,
      color: this.selectedColor,
      size: this.selectedSize,
      qty: this.quantity,
    };

    Cart.addItem(cartItem);
    
    // Reset quantity
    this.quantity = 1;
    document.getElementById('qtyInput').value = 1;
  },

  toggleWishlist() {
    const wishlist = Util.getFromStorage('byose_market_wishlist', []);
    const btn = document.getElementById('addWishlistBtn');
    const icon = btn.querySelector('i');
    const exists = wishlist.some(item => item.id === this.product.id);

    if (exists) {
      const newWishlist = wishlist.filter(item => item.id !== this.product.id);
      Util.setToStorage('byose_market_wishlist', newWishlist);
      icon.classList.remove('fas');
      icon.classList.add('far');
      btn.textContent = '';
      btn.innerHTML = '<i class="far fa-heart"></i> Add to Wishlist';
      Util.showInfo('Removed from wishlist');
    } else {
      wishlist.push({
        id: this.product.id,
        name: this.product.name,
        price: this.product.price,
        image: this.product.image,
      });
      Util.setToStorage('byose_market_wishlist', wishlist);
      icon.classList.remove('far');
      icon.classList.add('fas');
      btn.textContent = '';
      btn.innerHTML = '<i class="fas fa-heart"></i> Added to Wishlist';
      Util.showSuccess('Added to wishlist!');
    }

    updateWishlistBadge();
  },

  switchTab(tabName) {
    // Hide all tabs
    document.querySelectorAll('.tab-content').forEach(tab => tab.classList.remove('active'));
    document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));

    // Show selected tab
    const tabElement = document.getElementById(tabName + 'Tab');
    const btnElement = document.querySelector(`[data-tab="${tabName}"]`);

    if (tabElement) tabElement.classList.add('active');
    if (btnElement) btnElement.classList.add('active');
  },

  loadRelatedProducts() {
    const container = document.getElementById('relatedProducts');
    const related = ProductsDB.getByCategory(this.product.category)
      .filter(p => p.id !== this.product.id)
      .slice(0, 4);

    if (related.length === 0) {
      container.innerHTML = '<p>No related products available</p>';
      return;
    }

    container.innerHTML = related.map(product => this.createProductCard(product)).join('');
    this.setupRelatedProductCards();
  },

  createProductCard(product) {
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
          </div>
        </div>
      </div>
    `;
  },

  setupRelatedProductCards() {
    document.querySelectorAll('#relatedProducts .product-card').forEach(card => {
      card.addEventListener('click', (e) => {
        if (e.target.closest('.product-wishlist') || e.target.closest('.btn-add-cart')) {
          return;
        }
        const productId = card.dataset.productId;
        window.location.href = `product-details.html?id=${productId}`;
      });
    });

    document.querySelectorAll('#relatedProducts .btn-add-cart').forEach(btn => {
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

    document.querySelectorAll('#relatedProducts .product-wishlist').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const productId = btn.dataset.productId;
        const product = ProductsDB.getById(productId);
        const icon = btn.querySelector('i');

        if (product) {
          const wishlist = Util.getFromStorage('byose_market_wishlist', []);
          const exists = wishlist.some(item => item.id === productId);

          if (exists) {
            const newWishlist = wishlist.filter(item => item.id !== productId);
            Util.setToStorage('byose_market_wishlist', newWishlist);
            icon.classList.remove('fas');
            icon.classList.add('far');
          } else {
            wishlist.push({
              id: product.id,
              name: product.name,
              price: product.price,
              image: product.image,
            });
            Util.setToStorage('byose_market_wishlist', wishlist);
            icon.classList.remove('far');
            icon.classList.add('fas');
          }

          updateWishlistBadge();
        }
      });
    });
  },
};

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
  ProductDetail.init();
});
