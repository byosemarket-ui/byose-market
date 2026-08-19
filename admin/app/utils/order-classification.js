/**
 * Shared Admin Orders classification.
 * Payment status and delivery/order status stay independent.
 * Reads existing order fields; never writes payment records.
 *
 * Real fields (do not invent names):
 * A. Payment completed  → paymentStatus / payment.status
 *    Canonical settled values from server/payments/payment-status.js:
 *    paid, success, successful, completed, complete, payment_successful
 * B. COD / Pay on Delivery → paymentMethod / payment.method (canonical "cod")
 *    Storefront aliases: cod, cash_on_delivery, cash; paymentType "cod" as fallback
 * C. Payment pending → awaiting_payment, awaiting_delivery_payment, pending, unpaid, authorized
 * D. Payment failed → fail / decline / error in payment status
 * E. Payment cancelled → cancel in payment status (not order status)
 * F. Refunded → refund in payment status, refundRequired, returnWorkflow
 * G. Delivery completed → order status delivered/completed (deliveryStatus aliases status)
 * H. Order cancelled → order status includes cancel
 *
 * Amount paid / amount due are not classification inputs; Admin normalize does not
 * expose a reliable amountPaid field, and zero paid must not imply COD or unpaid-by-method.
 */

export const ORDER_VIEWS = Object.freeze({
  ALL: "all",
  PENDING: "pending",
  PAID: "paid",
  COMPLETED: "completed",
  CANCELLED: "cancelled",
  RETURNS: "returns",
  COD: "cod"
});

const COD_METHOD_IDS = new Set([
  "cod",
  "cash",
  "cash_on_delivery",
  "pay_on_delivery",
  "payondelivery"
]);

const MTN_METHOD_IDS = new Set(["mtn", "mtn_momo", "momo"]);
const CARD_METHOD_IDS = new Set(["card", "visa", "mastercard", "visa_mastercard"]);

function asText(value) {
  if (value == null) return "";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value).trim();
  }
  return "";
}

function normalizeKey(value) {
  return asText(value).toLowerCase().replace(/[\s-]+/g, "_");
}

function readPaymentObject(order) {
  const payment = order?.payment;
  return payment && typeof payment === "object" && !Array.isArray(payment) ? payment : {};
}

export function readPaymentMethodValue(order) {
  const payment = readPaymentObject(order);
  return asText(order?.paymentMethod || payment.method);
}

export function readPaymentStatusValue(order) {
  const payment = readPaymentObject(order);
  const canonical = asText(order?.paymentStatus || payment.status);
  if (canonical) return canonical;
  return asText(order?.paymentStatusLabel || payment.statusLabel);
}

function canonicalMethodFromKey(method) {
  if (MTN_METHOD_IDS.has(method)) return "mtn";
  if (CARD_METHOD_IDS.has(method)) return "card";
  if (COD_METHOD_IDS.has(method)) return "cod";
  if (method === "airtel" || method === "airtel_money") return "airtel";
  if (method === "bank" || method === "bank_transfer") return "bank";
  return "";
}

export function resolveCanonicalPaymentMethod(order) {
  const method = normalizeKey(readPaymentMethodValue(order));
  const fromMethod = canonicalMethodFromKey(method);
  if (fromMethod) return fromMethod;
  if (method) return method;

  const paymentType = normalizeKey(order?.paymentType || readPaymentObject(order).type);
  if (paymentType === "cod") return "cod";

  const label = asText(order?.paymentMethodLabel || readPaymentObject(order).methodLabel).toLowerCase();
  if (!label) return "";
  if (label.includes("cash on delivery") || label.includes("pay on delivery") || label === "cod") {
    return "cod";
  }
  if (label.includes("mtn") || /\bmomo\b/.test(label)) return "mtn";
  if (label.includes("card") || label.includes("visa") || label.includes("mastercard")) return "card";
  return "";
}

export function isCodPaymentMethod(orderOrMethod) {
  if (orderOrMethod && typeof orderOrMethod === "object") {
    return resolveCanonicalPaymentMethod(orderOrMethod) === "cod";
  }
  return resolveCanonicalPaymentMethod({ paymentMethod: orderOrMethod }) === "cod";
}

export function isSettledPaidStatus(value) {
  const status = asText(value).toLowerCase();
  if (!status) return false;
  if (
    status.includes("unpaid")
    || status.includes("awaiting")
    || status.includes("pending")
    || status.includes("fail")
    || status.includes("cancel")
    || status.includes("decline")
    || status.includes("unsuccess")
    || status.includes("invalid")
    || status.includes("refund")
  ) {
    return false;
  }
  return status === "paid"
    || status === "success"
    || status === "successful"
    || status === "completed"
    || status === "complete"
    || status === "payment_successful";
}

export function isPaidPayment(order) {
  return isSettledPaidStatus(readPaymentStatusValue(order));
}

export function resolvePaymentStatusKind(order) {
  const raw = readPaymentStatusValue(order);
  const status = raw.toLowerCase();
  if (!status) return "unknown";
  if (status.includes("refund")) return "refunded";
  if (status.includes("fail") || status.includes("decline") || status.includes("error")) return "failed";
  if (status.includes("cancel")) return "cancelled";
  if (isSettledPaidStatus(status)) return "paid";
  if (
    status.includes("awaiting")
    || status.includes("pending")
    || status.includes("unpaid")
    || status === "authorized"
  ) {
    return "pending";
  }
  return "unknown";
}

function readOrderStatus(order) {
  return asText(order?.status || order?.orderStatus).toLowerCase();
}

function isCancelledOrder(order) {
  return readOrderStatus(order).includes("cancel");
}

function isReturnsOrder(order) {
  const status = readOrderStatus(order);
  const payment = readPaymentStatusValue(order).toLowerCase();
  const workflow = order?.returnWorkflow && typeof order.returnWorkflow === "object"
    ? order.returnWorkflow
    : {};
  const returnStatus = asText(workflow.returnStatus || order?.returnStatus).toLowerCase();
  const refundStatus = asText(workflow.refundStatus || order?.refundStatus).toLowerCase();
  const hasReturnWorkflow = Boolean(returnStatus || refundStatus);
  // Only real return/refund signals — never fall back to generic paymentStatus.
  const needsRefund = Boolean(order?.refundRequired)
    || payment.includes("refund_required")
    || refundStatus === "required"
    || refundStatus === "pending";
  return status.includes("return")
    || status.includes("refund")
    || needsRefund
    || hasReturnWorkflow;
}

function isCompletedOrder(order) {
  const status = readOrderStatus(order);
  if (status.includes("cancel") || status.includes("return") || status.includes("refund")) {
    return false;
  }
  return status === "delivered"
    || status === "completed"
    || status.includes("deliver")
    || status.includes("complete");
}

function isPendingOrder(order) {
  const status = readOrderStatus(order);
  const payment = readPaymentStatusValue(order).toLowerCase();
  if (
    status.includes("cancel")
    || status.includes("return")
    || status.includes("refund")
    || status.includes("deliver")
    || status.includes("complete")
    || status.includes("ship")
    || status.includes("pack")
    || status.includes("process")
    || status.includes("confirm")
  ) {
    return false;
  }
  return status === "pending"
    || payment.includes("awaiting_payment")
    || payment.includes("awaiting payment")
    || payment.includes("awaiting_delivery_payment");
}

const EMPTY_CLASSIFICATION = Object.freeze({
  paymentMethod: "",
  paymentStatusRaw: "",
  paymentStatusKind: "unknown",
  isPaidPayment: false,
  isCodMethod: false,
  views: Object.freeze({
    all: true,
    pending: false,
    paid: false,
    completed: false,
    cancelled: false,
    returns: false,
    cod: false
  })
});

export function classifyOrder(order) {
  try {
    const safeOrder = order && typeof order === "object" && !Array.isArray(order) ? order : {};
    const paymentMethod = resolveCanonicalPaymentMethod(safeOrder);
    const paymentStatusRaw = readPaymentStatusValue(safeOrder);
    const paymentStatusKind = resolvePaymentStatusKind(safeOrder);
    const isPaid = isSettledPaidStatus(paymentStatusRaw);
    const isCodMethod = paymentMethod === "cod";
    const cancelled = isCancelledOrder(safeOrder);
    const returns = isReturnsOrder(safeOrder);
    const completed = isCompletedOrder(safeOrder);
    const pending = isPendingOrder(safeOrder);

    return {
      paymentMethod,
      paymentStatusRaw,
      paymentStatusKind,
      isPaidPayment: isPaid,
      isCodMethod,
      views: {
        all: true,
        pending,
        paid: isPaid && !cancelled && !returns,
        completed,
        cancelled,
        returns,
        // COD stays in the COD view until payment is explicitly recorded as received.
        // Delivery completion never promotes COD to Paid.
        cod: isCodMethod && !isPaid && !cancelled && !returns
      }
    };
  } catch {
    return {
      paymentMethod: "",
      paymentStatusRaw: "",
      paymentStatusKind: "unknown",
      isPaidPayment: false,
      isCodMethod: false,
      views: { ...EMPTY_CLASSIFICATION.views }
    };
  }
}

export function orderMatchesView(order, filter) {
  const raw = asText(filter).toLowerCase();
  if (!raw) return true;
  if (raw.startsWith("status:")) {
    return readOrderStatus(order) === raw.slice("status:".length);
  }

  const result = classifyOrder(order);
  switch (raw) {
    case ORDER_VIEWS.PENDING:
    case "pending-orders":
      return result.views.pending;
    case ORDER_VIEWS.PAID:
    case "paid-orders":
      return result.views.paid;
    case ORDER_VIEWS.COMPLETED:
    case "completed-orders":
      return result.views.completed;
    case ORDER_VIEWS.CANCELLED:
    case "cancelled-orders":
      return result.views.cancelled;
    case ORDER_VIEWS.RETURNS:
    case "returns-refunds":
      return result.views.returns;
    case ORDER_VIEWS.COD:
    case "cod-orders":
    case "pay-on-delivery":
      return result.views.cod;
    case ORDER_VIEWS.ALL:
      return true;
    default:
      return readOrderStatus(order) === raw || readOrderStatus(order).includes(raw);
  }
}

export const matchesNavStatus = orderMatchesView;
