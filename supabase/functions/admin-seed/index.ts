// Edge Function: admin-seed  （站主專用管理工具，x-admin-token 保護）
// 用 service role 做需要繞過 RLS 的管理動作：清募資範例、上傳封面圖、建立募資專案。
// 部署：supabase functions deploy admin-seed --no-verify-jwt
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Method", { status: 405 });
  const token = req.headers.get("x-admin-token") || "";
  if (!token || token !== Deno.env.get("ADMIN_TOKEN")) {
    return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: { "Content-Type": "application/json" } });
  }
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const BUCKET = Deno.env.get("BUCKET") || "doll-product-images";
  const admin = createClient(SUPABASE_URL, SERVICE_KEY);
  const out: Record<string, unknown> = {};

  try {
    const body = await req.json();

    // 1) 清掉所有募資專案（含範例）
    if (body.clear_campaigns) {
      const { error } = await admin.from("doll_campaigns").delete().not("id", "is", null);
      out.clear_campaigns = error ? ("err:" + error.message) : "ok";
    }
    // 2) 清掉測試訂單（DG 開頭）
    if (body.clear_test_orders) {
      const { error } = await admin.from("doll_orders").delete().like("merchant_trade_no", "DG%");
      out.clear_test_orders = error ? ("err:" + error.message) : "ok";
    }

    // 3) 建立一個募資專案（可含封面圖 base64）
    if (body.campaign) {
      const c = body.campaign;
      let image_url: string | null = c.image_url || null;
      if (c.image_base64) {
        const bin = Uint8Array.from(atob(c.image_base64), (ch) => ch.charCodeAt(0));
        const ext = (c.image_ext || "webp").replace(/[^a-z0-9]/gi, "") || "webp";
        const path = `campaigns/${Date.now()}.${ext}`;
        const { error: upErr } = await admin.storage.from(BUCKET)
          .upload(path, bin, { contentType: c.content_type || "image/webp", upsert: true });
        if (upErr) throw new Error("upload: " + upErr.message);
        image_url = admin.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
      }
      const days = Number(c.deadline_days ?? 30);
      const deadline = new Date(Date.now() + days * 86400000).toISOString();
      const { data, error } = await admin.from("doll_campaigns").insert({
        creator_id: c.creator_id ?? null,
        creator_name: c.creator_name ?? "團主",
        title: c.title,
        descr: c.descr ?? null,
        image_url,
        unit_price: c.unit_price,
        goal_qty: c.goal_qty,
        pledged_qty: c.pledged_qty ?? 0,
        deadline,
      }).select().single();
      if (error) throw new Error("insert: " + error.message);
      out.campaign = { id: data.id, image_url };
    }

    // 4) 依 email 查使用者
    async function findUser(email: string) {
      const { data } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
      return data?.users?.find((u) => (u.email || "").toLowerCase() === email.toLowerCase()) || null;
    }
    if (body.lookup_email) {
      const u = await findUser(body.lookup_email);
      out.user = u ? { id: u.id, email: u.email, name: u.user_metadata?.name } : null;
    }

    // 5) 把所有募資專案（可含商品）指派給某 email 的帳號當團主/賣家
    if (body.assign_owner) {
      const email = body.assign_owner.email;
      const u = await findUser(email);
      if (!u) { out.assign_owner = "user_not_found"; }
      else {
        const name = body.assign_owner.creator_name || u.user_metadata?.name || "團主";
        const r1 = await admin.from("doll_campaigns").update({ creator_id: u.id, creator_name: name }).not("id", "is", null);
        const res: Record<string, unknown> = { user_id: u.id, name, campaigns: r1.error ? ("err:" + r1.error.message) : "ok" };
        if (body.assign_owner.also_products) {
          const r2 = await admin.from("doll_products").update({ seller_id: u.id, seller_name: name }).eq("for_sale", true);
          res.products = r2.error ? ("err:" + r2.error.message) : "ok";
        }
        out.assign_owner = res;
      }
    }

    return new Response(JSON.stringify({ ok: true, ...out }), { headers: { "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
});
