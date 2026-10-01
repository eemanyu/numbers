export default async function handler(request, response) {
  if (request.method !== "POST") {
    return response.status(405).json({ error: "Método não permitido." });
  }

  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    return response.status(500).json({
      error: "GEMINI_API_KEY não configurada na Vercel."
    });
  }

  try {
    const body = typeof request.body === "string"
      ? JSON.parse(request.body)
      : request.body;

    const image = body?.image;

    if (typeof image !== "string" || !image.startsWith("data:image/")) {
      return response.status(400).json({
        error: "Imagem inválida."
      });
    }

    const match = image.match(/^data:(image\/[^;]+);base64,(.+)$/s);

    if (!match) {
      return response.status(400).json({
        error: "Formato de imagem inválido."
      });
    }

    const mimeType = match[1];
    const base64Data = match[2];

    const prompt = [
      "Você é um leitor especializado em números manuscritos.",
      "A imagem é um recorte CENTRAL da câmera e pode conter mais de um número.",
      "LEIA SOMENTE UM NÚMERO: aquele cujo centro está mais próximo do centro exato da imagem.",
      "IGNORE completamente qualquer outro número, mesmo que esteja parcialmente visível.",
      "O número pode estar escrito à mão com caneta e pode estar torto, inclinado, com sombra, brilho ou perspectiva.",
      "Não concatene números diferentes.",
      "Não invente dígitos.",
      "Se não houver um único número claramente legível no centro, retorne uma string vazia.",
      "Responda SOMENTE em JSON no formato: {"number":"123"}.",
      "Se não conseguir ler, responda: {"number":""}."
    ].join(" ");

    const geminiResponse = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey
        },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                { text: prompt },
                {
                  inline_data: {
                    mime_type: mimeType,
                    data: base64Data
                  }
                }
              ]
            }
          ],
          generationConfig: {
            responseMimeType: "application/json",
            maxOutputTokens: 32
          }
        })
      }
    );

    const geminiData = await geminiResponse.json();

    if (!geminiResponse.ok) {
      console.error("Gemini API error:", geminiData);
      return response.status(502).json({
        error: "Gemini não conseguiu processar a imagem."
      });
    }

    const text =
      geminiData?.candidates?.[0]?.content?.parts
        ?.map(part => part.text || "")
        .join("")
        .trim() || "";

    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = { number: "" };
    }

    const number = String(parsed?.number || "")
      .replace(/[^0-9]/g, "")
      .slice(0, 20);

    return response.status(200).json({ number });
  } catch (error) {
    console.error("OCR server error:", error);

    return response.status(500).json({
      error: "Erro interno ao ler o número."
    });
  }
}
