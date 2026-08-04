-- Enforce the fixed RWF 2,000 delivery rule for stored orders.
UPDATE orders
SET
    shipping_fee = 2000,
    delivery_fee = 2000,
    cod_fee = 0,
    total_amount = subtotal + 2000,
    total_price = subtotal + 2000
WHERE
    shipping_fee != 2000
    OR delivery_fee != 2000
    OR cod_fee != 0
    OR total_amount != subtotal + 2000
    OR total_price != subtotal + 2000;
