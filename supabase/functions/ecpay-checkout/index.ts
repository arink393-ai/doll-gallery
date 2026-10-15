// Edge Function: ecpay-checkout
// 前端帶著登入者 JWT 呼叫；建立訂單、產生綠界付款表單參數（含 CheckMacValue）回傳。
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { ECPAY_ACTION, ecpayDate, genCheckMacValue } from "../_shared/ecpay.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

// 費率（與前端一致）
const COMMISSION_RATE = 0.05;
const PAYMENT_RATE = 0.025;
const PAYMENT_FIXED = 5;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const MERCHANT_ID = Deno.env.get("ECPAY_MERCHANT_ID")!;
    const HASH_KEY = Deno.env.get("ECPAY_HASH_KEY")!;
    const HASH_IV = Deno.env.get("ECPAY_HASH_IV")!;
    const ENV = (Deno.env.get("ECPAY_ENV") || "stage") as "stage" | "prod";
    const SITE_URL = Deno.env.get("SITE_URL") || "https://arink393-ai.github.io/doll-gallery/";

    // 驗證登入者
    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace("Bearer ", "");
    const admin = createClient(SUPABASE_URL, SERVICE_KEY);
    const { data: userData, error: userErr } = await admin.auth.getUser(token);
    if (userErr || !userData.user) return json({ error: "請先登入再購買。" }, 401);
    const buyer = userData.user;

    const { product_id, campaign_id, qty } = await req.json().catch(() => ({}));

    // 組訂單資料：一般商品 or 棉花娃娃募資贊助
    let orderRow: Record<string, unknown>;
    let itemNameRaw: string;
    let amount: number;

    if (campaign_id) {
      const n = Math.max(1, Math.min(99, parseInt(qty) || 1));
      const { data: camp, error: cErr } = await admin
        .from("doll_campaigns").select("*").eq("id", campaign_id).single();
      if (cErr || !camp) return json({ error: "找不到募資專案。" }, 404);
      if (!camp.active) return json({ error: "此募資專案已關閉。" }, 400);
      if (new Date(camp.deadline).getTime() < Date.now())
        return json({ error: "此募資專案已截止。" }, 400);
      amount = camp.unit_price * n;
      itemNameRaw = `${camp.title} x${n}`;
      orderRow = {
        campaign_id: camp.id, qty: n,
        product_title: `${camp.title}（募資 x${n}）`,
        seller_id: camp.creator_id, seller_name: camp.creator_name,
      };
    } else {
      if (!product_id) return json({ error: "缺少商品 ID。" }, 400);
      const { data: product, error: pErr } = await admin
        .from("doll_products").select("*").eq("id", product_id).single();
      if (pErr || !product) return json({ error: "找不到商品。" }, 404);
      if (!product.for_sale) return json({ error: "此商品非販售品。" }, 400);
      if (product.seller_id && product.seller_id === buyer.id)
        return json({ error: "不能購買自己刊登的商品。" }, 400);
      amount = product.price;
      itemNameRaw = product.title;
      orderRow = {
        product_id: product.id, qty: 1,
        product_title: product.title,
        seller_id: product.seller_id, seller_name: product.seller_name,
      };
    }

    // 費用
    const feeCommission = Math.round(amount * COMMISSION_RATE);
    const feePayment = Math.round(amount * PAYMENT_RATE + PAYMENT_FIXED);
    const sellerPayout = amount - feeCommission - feePayment;

    // 綠界訂單編號（<=20 英數）
    const merchantTradeNo = ("DG" + Date.now() + Math.floor(Math.random() * 900 + 100)).slice(0, 20);

    // 建立訂單（pending）
    const { data: order, error: oErr } = await admin.from("doll_orders").insert({
      ...orderRow,
      merchant_trade_no: merchantTradeNo,
      buyer_id: buyer.id,
      buyer_email: buyer.email,
      amount, fee_commission: feeCommission, fee_payment: feePayment,
      seller_payout: sellerPayout, status: "pending",
    }).select().single();
    if (oErr) return json({ error: "建立訂單失敗：" + oErr.message }, 500);

    // 綠界參數
    const notifyURL = `${SUPABASE_URL}/functions/v1/ecpay-notify`;
    const itemName = String(itemNameRaw).replace(/[#&]/g, " ").slice(0, 200);
    const params: Record<string, string> = {
      MerchantID: MERCHANT_ID,
      MerchantTradeNo: merchantTradeNo,
      MerchantTradeDate: ecpayDate(),
      PaymentType: "aio",
      TotalAmount: String(amount),
      TradeDesc: "娃娃收藏館交易",
      ItemName: itemName,
      ReturnURL: notifyURL,
      ChoosePayment: "ALL",
      EncryptType: "1",
      ClientBackURL: SITE_URL + "?paid=" + merchantTradeNo,
      CustomField1: order.id,
    };
    params.CheckMacValue = await genCheckMacValue(params, HASH_KEY, HASH_IV);

    return json({ action: ECPAY_ACTION[ENV], params, order_id: order.id });
  } catch (e) {
    return json({ error: "系統錯誤：" + (e as Error).message }, 500);
  }
});
