// Edge Function: ecpay-notify  (綠界 ReturnURL：伺服器對伺服器付款結果通知)
// 綠界以 x-www-form-urlencoded POST 過來；驗證 CheckMacValue 後更新訂單狀態。
// 部署時用 --no-verify-jwt（綠界不會帶 Supabase JWT）；安全性靠 CheckMacValue 驗章。
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verifyCheckMacValue } from "../_shared/ecpay.ts";

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("0|Method", { status: 405 });
  try {
    const HASH_KEY = Deno.env.get("ECPAY_HASH_KEY")!;
    const HASH_IV = Deno.env.get("ECPAY_HASH_IV")!;
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const form = await req.formData();
    const params: Record<string, string> = {};
    for (const [k, v] of form.entries()) params[k] = String(v);

    // 驗章
    const ok = await verifyCheckMacValue(params, HASH_KEY, HASH_IV);
    if (!ok) return new Response("0|CheckMacValue Error", { status: 200 });

    const admin = createClient(SUPABASE_URL, SERVICE_KEY);
    const orderId = params.CustomField1;
    const mtn = params.MerchantTradeNo;
    const paid = params.RtnCode === "1";

    // 以 order id 優先，退而用 merchant_trade_no 定位
    const match = orderId ? { id: orderId } : { merchant_trade_no: mtn };
    const { data: order } = await admin.from("doll_orders").select("*").match(match).single();
    if (!order) return new Response("1|OK", { status: 200 }); // 找不到也回 1|OK 避免綠界重送

    if (order.status !== "paid") {
      await admin.from("doll_orders").update({
        status: paid ? "paid" : "failed",
        ecpay_trade_no: params.TradeNo || null,
        payment_type: params.PaymentType || null,
        paid_at: paid ? new Date().toISOString() : null,
      }).eq("id", order.id);
    }

    return new Response("1|OK", { status: 200 });
  } catch (_e) {
    return new Response("0|Error", { status: 200 });
  }
});
