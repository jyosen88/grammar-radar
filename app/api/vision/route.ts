import { NextRequest, NextResponse } from "next/server";

// 阿里云百炼 DashScope（OpenAI 兼容模式），qwen3-vl-flash 视觉模型（flash 档）
const DASHSCOPE_ENDPOINT =
  "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions";
const VL_MODEL = "qwen3-vl-flash";

const OCR_PROMPT = `你是一个 OCR 引擎。请提取图片中出现的所有英文文字（可能是手写或印刷的句子、段落、习题）。
要求：
1. 逐字转录原文，保留原有换行
2. 不要翻译、不要纠正拼写或语法、不要解释、不要添加任何额外内容
3. 如果图片中没有任何文字，只返回空字符串`;

export async function POST(req: NextRequest) {
  const apiKey = process.env.DASHSCOPE_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "服务端未配置 DASHSCOPE_API_KEY 环境变量" },
      { status: 500 }
    );
  }

  let imageUrl: unknown;
  try {
    const body = await req.json();
    imageUrl = body?.imageUrl;
  } catch {
    return NextResponse.json({ error: "请求格式错误" }, { status: 400 });
  }

  if (typeof imageUrl !== "string" || !imageUrl) {
    return NextResponse.json(
      { error: "缺少 imageUrl 参数" },
      { status: 400 }
    );
  }

  // 仅允许本项目 Supabase Storage 的公共地址，避免被当作任意 URL 代理
  let parsed: URL;
  try {
    parsed = new URL(imageUrl);
  } catch {
    return NextResponse.json({ error: "imageUrl 不是合法的 URL" }, { status: 400 });
  }
  const allowedPrefix = `${process.env.NEXT_PUBLIC_SUPABASE_URL ?? ""}/storage/`;
  if (parsed.protocol !== "https:" || !imageUrl.startsWith(allowedPrefix)) {
    return NextResponse.json(
      { error: "仅支持本项目 Supabase Storage 中的图片地址" },
      { status: 400 }
    );
  }

  try {
    // 本机网络偶发抽风（曾出现 fetch failed），失败时自动重试一次
    let res: Response | null = null;
    let lastErr: unknown = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        res = await fetch(DASHSCOPE_ENDPOINT, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model: VL_MODEL,
            messages: [
              {
                role: "user",
                content: [
                  { type: "image_url", image_url: { url: imageUrl } },
                  { type: "text", text: OCR_PROMPT },
                ],
              },
            ],
            temperature: 0.1,
            stream: false,
          }),
        });
        break;
      } catch (e) {
        lastErr = e;
      }
    }
    if (!res) throw lastErr;

    if (!res.ok) {
      const detail = await res.text();
      return NextResponse.json(
        {
          error: `千问视觉模型调用失败（HTTP ${res.status}）：${detail.slice(0, 400)}`,
        },
        { status: 502 }
      );
    }

    const data = await res.json();
    const content: unknown = data?.choices?.[0]?.message?.content;
    // 新版 SDK content 可能是字符串或多模态分段数组
    const text = Array.isArray(content)
      ? content
          .map((part) =>
            typeof part === "string" ? part : (part?.text ?? "")
          )
          .join("\n")
      : String(content ?? "");
    return NextResponse.json({ text: text.trim() });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "图片识别失败，请重试" },
      { status: 500 }
    );
  }
}
