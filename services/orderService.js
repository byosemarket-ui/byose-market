import supabase from "../config/supabase.js";

const ORDERS_TABLE = "orders";
const REVIEWS_TABLE = "product_reviews";

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function mapError(error, fallbackMessage) {
  return error instanceof Error ? error : new Error(String(error?.message || fallbackMessage || "Supabase order request failed."));
}

export async function listOrders(limit = 100) {
  const { data, error } = await supabase
    .from(ORDERS_TABLE)
    .select("*")
    .order("created_at", { ascending: false })
    .limit(Math.max(1, Number(limit || 100)));

  if (error) {
    throw mapError(error, "Unable to load orders from Supabase.");
  }

  return asArray(data);
}

export async function createOrder(orderPayload) {
  const { data, error } = await supabase
    .from(ORDERS_TABLE)
    .insert(orderPayload)
    .select("*")
    .single();

  if (error) {
    throw mapError(error, "Unable to save the order to Supabase.");
  }

  return data;
}

export async function updateOrderStatus(orderId, status) {
  const { data, error } = await supabase
    .from(ORDERS_TABLE)
    .update({ status, order_status: String(status || "").toLowerCase() })
    .eq("order_id", orderId)
    .select("*")
    .single();

  if (error) {
    throw mapError(error, "Unable to update the order status in Supabase.");
  }

  return data;
}

export async function listProductReviews(productCatalogId) {
  const { data, error } = await supabase
    .from(REVIEWS_TABLE)
    .select("*")
    .eq("product_catalog_id", Number(productCatalogId || 0))
    .order("created_at", { ascending: false });

  if (error) {
    throw mapError(error, "Unable to load product reviews from Supabase.");
  }

  return asArray(data);
}

export async function createProductReview(reviewPayload) {
  const { data, error } = await supabase
    .from(REVIEWS_TABLE)
    .insert(reviewPayload)
    .select("*")
    .single();

  if (error) {
    throw mapError(error, "Unable to save the product review to Supabase.");
  }

  return data;
}

export default {
  listOrders,
  createOrder,
  updateOrderStatus,
  listProductReviews,
  createProductReview
};