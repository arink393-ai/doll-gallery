// 綠界 ECPay 共用工具：CheckMacValue 產生與驗證、參數編碼
// 依綠界規格：參數 A~Z 排序 → 前後加 HashKey/HashIV → .NET 風格 URL encode → 轉小寫 → SHA256 → 轉大寫

export const ECPAY_ACTION = {
  stage: "https://payment-stage.ecpay.com.tw/Cashier/AioCheckOut/V5",
  prod: "https://payment.ecpay.com.tw/Cashier/AioCheckOut/V5",
};

function dotNetUrlEncode(s: string): string {
  return encodeURIComponent(s)
    .replace(/%20/g, "+")
    .replace(/%21/g, "!")
    .replace(/%27/g, "'")
    .replace(/%28/g, "(")
    .replace(/%29/g, ")")
    .replace(/%2a/g, "*")
    .replace(/%2d/g, "-")
    .replace(/%2e/g, ".")
    .replace(/%5f/g, "_");
}

async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function genCheckMacValue(
  params: Record<string, string>,
  hashKey: string,
  hashIV: string,
): Promise<string> {
  // 排除 CheckMacValue，其餘全部納入（含空字串值）——與綠界一致；勿過濾空值。
  const keys = Object.keys(params)
    .filter((k) => k !== "CheckMacValue" && params[k] !== undefined && params[k] !== null)
    .sort((a, b) => (a.toLowerCase() < b.toLowerCase() ? -1 : a.toLowerCase() > b.toLowerCase() ? 1 : 0));
  const query = keys.map((k) => `${k}=${params[k]}`).join("&");
  const raw = `HashKey=${hashKey}&${query}&HashIV=${hashIV}`;
  const encoded = dotNetUrlEncode(raw).toLowerCase();
  const hash = await sha256Hex(encoded);
  return hash.toUpperCase();
}

export async function verifyCheckMacValue(
  params: Record<string, string>,
  hashKey: string,
  hashIV: string,
): Promise<boolean> {
  const given = (params.CheckMacValue || "").toUpperCase();
  const calc = await genCheckMacValue(params, hashKey, hashIV);
  return given.length > 0 && given === calc;
}

// yyyy/MM/dd HH:mm:ss（台灣時間）
export function ecpayDate(d = new Date()): string {
  const tw = new Date(d.getTime() + 8 * 3600 * 1000); // UTC+8
  const p = (n: number) => String(n).padStart(2, "0");
  return `${tw.getUTCFullYear()}/${p(tw.getUTCMonth() + 1)}/${p(tw.getUTCDate())} ${p(tw.getUTCHours())}:${p(tw.getUTCMinutes())}:${p(tw.getUTCSeconds())}`;
}
