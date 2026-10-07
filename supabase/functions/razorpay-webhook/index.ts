import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

// Public half of the Ed25519 pair that signs licences and credit codes. Safe to
// embed: it can only verify, never mint.
const SIGNING_PUBLIC_KEY_SPKI =
  "MCowBQYDK2VwAyEAo+asrmOfriWiCL8hgl9B6w6XDQq6Ddv0BoeDOds4i2I=";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, x-razorpay-signature",
};

const json = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const validMachineId = (value: unknown) =>
  typeof value === "string" && /^[a-zA-Z0-9_-]{1,80}$/.test(value);

function base64ToBytes(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

async function signatureFor(body: Uint8Array, secret: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, body);
  return Array.from(new Uint8Array(signature))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function signaturesMatch(received: string | null, expected: string) {
  if (!received || received.length !== expected.length) return false;
  let difference = 0;
  for (let index = 0; index < expected.length; index += 1) {
    difference |= received.charCodeAt(index) ^ expected.charCodeAt(index);
  }
  return difference === 0;
}

let cachedPublicKey: CryptoKey | null = null;

async function getSigningPublicKey(): Promise<CryptoKey> {
  if (!cachedPublicKey) {
    cachedPublicKey = await crypto.subtle.importKey(
      "spki",
      base64ToBytes(SIGNING_PUBLIC_KEY_SPKI),
      { name: "Ed25519" },
      false,
      ["verify"],
    );
  }
  return cachedPublicKey;
}

/**
 * Verifies a `base64url(payload).base64url(signature)` note and returns the
 * payload string, or null. Mirrors `parseEntitlementNote` in api/p1/_helpers.js.
 */
async function verifyEntitlementNote(note: unknown): Promise<string | null> {
  if (typeof note !== "string") return null;
  const dot = note.indexOf(".");
  if (dot <= 0 || dot === note.length - 1) return null;
  try {
    const payloadBytes = base64ToBytes(note.slice(0, dot));
    const signature = base64ToBytes(note.slice(dot + 1));
    const key = await getSigningPublicKey();
    const ok = await crypto.subtle.verify("Ed25519", key, signature, payloadBytes);
    return ok ? new TextDecoder().decode(payloadBytes) : null;
  } catch {
    return null;
  }
}

function parseEntitlementPayload(payload: string) {
  const parts = payload.split(":");
  if (parts.length !== 5) return null;
  const [kind, amountPaise, days, credits, perCreditPaise] = parts;
  if (kind !== "individual" && kind !== "credits") return null;
  const amount = Number(amountPaise);
  const duration = Number(days);
  const creditCount = Number(credits);
  const perCredit = Number(perCreditPaise);
  if (!Number.isInteger(amount) || amount <= 0) return null;
  if (!Number.isInteger(duration) || duration <= 0) return null;
  if (!Number.isInteger(creditCount) || creditCount < 0) return null;
  if (!Number.isInteger(perCredit) || perCredit < 0) return null;
  if (kind === "credits" && (creditCount <= 0 || creditCount * perCredit !== amount)) return null;
  if (kind === "individual" && (creditCount !== 0 || perCredit !== 0)) return null;
  return { kind, amountPaise: amount, days: duration, credits: creditCount };
}

/**
 * Razorpay callback. Validates and acknowledges only - entitlement is issued by
 * /api/p1/verify-payment, which re-checks the link against Razorpay's API.
 *
 * Kept in step with api/p1/webhook.js; both derive the purchase from the signed
 * entitlement note rather than a hardcoded amount.
 */
serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);

  const secret = Deno.env.get("RAZORPAY_WEBHOOK_SECRET");
  if (!secret) return json({ error: "Webhook secret is not configured." }, 500);

  try {
    const rawBody = new Uint8Array(await request.arrayBuffer());
    const expected = await signatureFor(rawBody, secret);
    if (!signaturesMatch(request.headers.get("x-razorpay-signature"), expected)) {
      return json({ error: "Invalid webhook signature." }, 400);
    }

    const payload = JSON.parse(new TextDecoder().decode(rawBody));
    if (payload.event !== "payment_link.paid") return json({ received: true, ignored: true });

    const paymentLink = payload.payload?.payment_link?.entity;
    const machineId = paymentLink?.notes?.machine_id;
    if (!paymentLink || !validMachineId(machineId)) {
      return json({ error: "Invalid payment link payload." }, 400);
    }

    const note = await verifyEntitlementNote(paymentLink.notes?.ent);
    if (!note) return json({ error: "Payment link is not a GetPcHealth purchase." }, 400);

    const entitlement = parseEntitlementPayload(note);
    if (!entitlement) return json({ error: "Payment link entitlement is malformed." }, 400);
    if (
      paymentLink.status !== "paid" ||
      paymentLink.currency !== "INR" ||
      paymentLink.amount !== entitlement.amountPaise
    ) {
      return json({ error: "Payment link does not match its entitlement." }, 400);
    }

    return json({
      received: true,
      paymentLinkId: paymentLink.id,
      machineId,
      kind: entitlement.kind,
      credits: entitlement.credits,
      days: entitlement.days,
    });
  } catch {
    return json({ error: "Invalid webhook payload." }, 400);
  }
});
