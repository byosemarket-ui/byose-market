/* =========================
IMAGE GALLERY
========================= */

const mainImage = document.getElementById("mainImage");
const thumbs = document.querySelectorAll(".thumb");

thumbs.forEach(img => {

img.addEventListener("click",()=>{

thumbs.forEach(t=>t.classList.remove("active"));

img.classList.add("active");

mainImage.src = img.src;

});

});


/* =========================
SWIPE SYSTEM (PHONE)
========================= */

let startX = 0;

mainImage.addEventListener("touchstart",(e)=>{

startX = e.touches[0].clientX;

});

mainImage.addEventListener("touchend",(e)=>{

let endX = e.changedTouches[0].clientX;

if(endX < startX - 50){

nextImage();

}

if(endX > startX + 50){

prevImage();

}

});


let current = 0;

function nextImage(){

current++;

if(current >= thumbs.length){

current = 0;

}

changeImage();

}

function prevImage(){

current--;

if(current < 0){

current = thumbs.length - 1;

}

changeImage();

}

function changeImage(){

thumbs.forEach(t=>t.classList.remove("active"));

thumbs[current].classList.add("active");

mainImage.src = thumbs[current].src;

}





/* =========================
COLOR SELECT
========================= */

const colorBtns = document.querySelectorAll(".color-options button");

let selectedColor = "Black";

colorBtns.forEach(btn => {

btn.addEventListener("click",()=>{

colorBtns.forEach(b=>b.classList.remove("active"));

btn.classList.add("active");

selectedColor = btn.dataset.color;

});

});






/* =========================
SIZE SELECT
========================= */

const sizeBtns = document.querySelectorAll(".size-options button");

let selectedSize = "9";

sizeBtns.forEach(btn=>{

btn.addEventListener("click",()=>{

sizeBtns.forEach(b=>b.classList.remove("active"));

btn.classList.add("active");

selectedSize = btn.innerText;

});

});



/* =========================
QUANTITY
========================= */

const qtyInput = document.querySelector(".qty-box input");

const qtyBtns = document.querySelectorAll(".qty-box button");

qtyBtns[0].addEventListener("click",()=>{

let val = parseInt(qtyInput.value);

if(val>1){

qtyInput.value = val-1;

}

});

qtyBtns[1].addEventListener("click",()=>{

let val = parseInt(qtyInput.value);

qtyInput.value = val+1;

});




/* =========================
SELECT OPTIONS MODAL ELEMENTS (declare early)
========================= */

const modal = document.getElementById("selectModal");
const modalImage = document.getElementById("modalImage");
const modalTitle = document.getElementById("modalTitle");
const modalPrice = document.getElementById("modalPrice");


/* =========================
OPEN SELECT OPTIONS MODAL
All Add/Buy buttons should open the options modal so user selects color/size/qty
========================= */

const openCartBtns = document.querySelectorAll(".add-cart");

if (openCartBtns && openCartBtns.length) {
	openCartBtns.forEach(b => b.addEventListener('click', () => {
		if (!modal) return;
		modal.classList.add("active");
		modalImage.src = document.getElementById("mainImage").src;
		modalTitle.innerText = document.querySelector(".pd-title").innerText;
		modalPrice.innerText = "20000 Rwf";
	}));
}


/* =========================
TOTAL CALCULATION
========================= */

const price = 20000;

const totalEl = document.getElementById("totalPrice");

function updateTotal(){

	let qty = parseInt(qtyInput.value) || 1;

	let total = qty * price;

	totalEl.innerText = total + " Rwf";

}

qtyInput.addEventListener("input",updateTotal);

qtyBtns[0].addEventListener("click",updateTotal);

qtyBtns[1].addEventListener("click",updateTotal);


/* =========================
SELECT OPTIONS MODAL
========================= */

const closeModal = document.getElementById("closeModal");


// close modal
if (closeModal) {
	closeModal.addEventListener("click",()=>{
		modal.classList.remove("active");
	});
}

/* MODAL COLOR OPTIONS */

const modalColors = document.getElementById("modalColors");

const colors = ["Black","White","Red"];

let modalColor = "Black";

colors.forEach(color=>{

let btn = document.createElement("button");

btn.innerText = color;

btn.onclick = ()=>{

document.querySelectorAll("#modalColors button")
.forEach(b=>b.classList.remove("active"));

btn.classList.add("active");

modalColor = color;

};

modalColors.appendChild(btn);

});



/* MODAL SIZE OPTIONS */

const modalSizes = document.getElementById("modalSizes");

const sizes = ["7","8","9","10","11"];

let modalSize = "9";

sizes.forEach(size=>{

let btn = document.createElement("button");

btn.innerText = size;

btn.onclick = ()=>{

document.querySelectorAll("#modalSizes button")
.forEach(b=>b.classList.remove("active"));

btn.classList.add("active");

modalSize = size;

};

modalSizes.appendChild(btn);

});





/* CONFIRM ADD TO CART */

document.getElementById("confirmAddCart")
.addEventListener("click",()=>{

const qty = parseInt(document.getElementById("modalQty").value);

const title = modalTitle.innerText;

const image = modalImage.src;

const product = {

id: title.replace(/\s+/g, '_').toLowerCase(), // Create a simple id

name: title,

price: 20000,

image: image,

color: modalColor,

size: modalSize,

qty: qty

};

	// Use centralized cart integration only.
	if (window.Cart && Cart.addItem){
		Cart.addItem(product);
	} else if(window.KCart){
		KCart.add(product);
	} else if(window.addToCart){
		addToCart(product);
	} else {
		window.dispatchEvent(new CustomEvent('byose:storefront-cart-error', {
			detail: {
				action: 'add',
				message: 'Centralized cart service is unavailable. Please refresh and try again.'
			}
		}));
		throw new Error('Centralized cart service is unavailable.');
	}

	modal.classList.remove("active");

	alert("Product added to cart");

});

