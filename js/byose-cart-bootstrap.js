import ByoseCart from '../services/byose-cart.js';

window.ByoseCart = ByoseCart;
window.KCart = ByoseCart;

window.addToCart = function addToCart(itemOrItems) {
  const items = Array.isArray(itemOrItems) ? itemOrItems : [itemOrItems];
  items.filter(Boolean).forEach((item) => ByoseCart.add(item));
  return ByoseCart.getItems();
};

ByoseCart.init();

export default ByoseCart;
