import { QuoteData, Order } from "@/types";

/**
 * Mapea una fila de Supabase (snake_case) a QuoteData (camelCase).
 * Centralizado para evitar duplicación en ReservaPage, ConfirmacionPage, etc.
 */
export function mapQuoteFromSupabase(data: Record<string, unknown>): QuoteData {
  return {
    id: data.id as string,
    userId: data.user_id as string,
    serviceCategory: data.service_category as "home" | "commercial" | undefined,
    serviceSubtype: data.service_subtype as string,
    serviceType: data.service_type as "regular" | "deep" | "move_in_out" | "post_construction" | undefined,
    bedrooms: data.bedrooms as number,
    bathrooms: data.bathrooms as number,
    squareFeet: data.square_feet as number,
    petsCount: data.pets_count as number,
    petsType: data.pets_type as string,
    residents: data.residents as number,
    daysSinceCleaning: data.days_since_cleaning as number,
    address: data.address as string,
    zone: data.zone as string,
    postalCode: data.postal_code as string,
    dayOfWeek: data.day_of_week as number | undefined,
    isPreferredDay: data.is_preferred_day as boolean | undefined,
    basePrice: data.base_price as number,
    organicMultiplier: data.organic_multiplier as number,
    organicAdjustment: data.organic_adjustment as number,
    recencyMultiplier: data.recency_multiplier as number,
    recencyAdjustment: data.recency_adjustment as number,
    zoneSurcharge: data.zone_surcharge as number,
    logisticsSurcharge: data.logistics_surcharge as number,
    subtotal: data.subtotal as number,
    gst: data.gst as number,
    pst: data.pst as number,
    total: data.total as number,
    holdAmount: data.hold_amount as number,
    priceFrozenUntil: data.price_frozen_until as string,
    status: data.status as "pending" | "reserved" | "expired",
    consentTc: data.consent_tc as boolean,
    consentPipa: data.consent_pipa as boolean,
    consentMarketing: data.consent_marketing as boolean,
    clientScore: data.client_score as number,
    createdAt: data.created_at as string,
    updatedAt: data.updated_at as string,
  };
}

/**
 * Mapea una fila de Supabase (snake_case) a Order (camelCase).
 */
export function mapOrderFromSupabase(data: Record<string, unknown>): Order {
  return {
    id: data.id as string,
    quoteId: data.quote_id as string,
    userId: data.user_id as string,
    serviceDate: data.service_date as string,
    serviceTime: data.service_time as string,
    serviceDatetime: data.service_datetime as string,
    status: data.status as Order["status"],
    stripeCustomerId: data.stripe_customer_id as string | undefined,
    stripePaymentMethodId: data.stripe_payment_method_id as string | undefined,
    stripeSetupIntentId: data.stripe_setup_intent_id as string | undefined,
    paymentOption: data.payment_option as "card" | "paypal_first_time",
    paypalTransactionId: data.paypal_transaction_id as string | undefined,
    holdAmount: data.hold_amount as number,
    holdCapturedAt: data.hold_captured_at as string | undefined,
    holdReleasedAt: data.hold_released_at as string | undefined,
    cancellationWindowHours: data.cancellation_window_hours as number,
    createdAt: data.created_at as string,
    updatedAt: data.updated_at as string,
  };
}
