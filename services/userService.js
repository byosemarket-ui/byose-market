import supabase from "../config/supabase.js";

const USERS_TABLE = "users";
const CART_ITEMS_TABLE = "cart_items";
const VISITORS_TABLE = "visitors";

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function mapError(error, fallbackMessage) {
  return error instanceof Error ? error : new Error(String(error?.message || fallbackMessage || "Supabase user request failed."));
}

export async function getUsers(limit = 100) {
  const { data, error } = await supabase
    .from(USERS_TABLE)
    .select("*")
    .order("created_at", { ascending: false })
    .limit(Math.max(1, Number(limit || 100)));

  if (error) {
    throw mapError(error, "Unable to load users from Supabase.");
  }

  return asArray(data);
}

export async function upsertUser(userPayload) {
  const { data, error } = await supabase
    .from(USERS_TABLE)
    .upsert(userPayload)
    .select("*")
    .single();

  if (error) {
    throw mapError(error, "Unable to save the user to Supabase.");
  }

  return data;
}

export async function listCartItems(userId) {
  const { data, error } = await supabase
    .from(CART_ITEMS_TABLE)
    .select("*")
    .eq("user_id", String(userId || ""))
    .order("updated_at", { ascending: false });

  if (error) {
    throw mapError(error, "Unable to load cart items from Supabase.");
  }

  return asArray(data);
}

export async function upsertCartItem(cartItemPayload) {
  const { data, error } = await supabase
    .from(CART_ITEMS_TABLE)
    .upsert(cartItemPayload)
    .select("*")
    .single();

  if (error) {
    throw mapError(error, "Unable to save the cart item to Supabase.");
  }

  return data;
}

export async function recordVisitor(visitorPayload) {
  const { data, error } = await supabase
    .from(VISITORS_TABLE)
    .insert(visitorPayload)
    .select("*")
    .single();

  if (error) {
    throw mapError(error, "Unable to record the visitor session in Supabase.");
  }

  return data;
}

export default {
  getUsers,
  upsertUser,
  listCartItems,
  upsertCartItem,
  recordVisitor
};