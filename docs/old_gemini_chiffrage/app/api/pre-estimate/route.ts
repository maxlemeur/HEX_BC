import { GoogleGenAI, Type, ThinkingLevel } from "@google/genai";
import { NextResponse } from "next/server";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { fileData, mimeType } = body;

    if (!fileData || !mimeType) {
      return NextResponse.json(
        { error: "fileData (base64) et mimeType sont requis." },
        { status: 400 }
      );
    }

    const apiKey = process.env.GEMINI_API_KEY || process.env.NEXT_PUBLIC_GEMINI_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "Clé API Gemini manquante." },
        { status: 500 }
      );
    }

    const ai = new GoogleGenAI({ apiKey });

    const prompt = `
      Tu es un métreur/économiste de la construction expert.
      Analyse ce plan (architectural, structure ou MEP).
      Effectue un 'takeoff' (métré) complet en identifiant et quantifiant les éléments visibles (murs, portes, fenêtres, équipements, etc.).
      
      Pour chaque élément, fournis :
      - Le nom ou la désignation
      - La quantité estimée
      - L'unité appropriée (m2, ml, u)
      - La catégorie (ex: Gros oeuvre, Menuiserie)
      - Une 'evidence' détaillée expliquant comment tu as calculé ou déduit cette quantité à partir du plan (ex: "Comptage visuel de 5 portes simples sur le plan RDC", "Surface déduite des cotes de la pièce principale")
      - Un score de 'confidence' (entre 0.0 et 1.0) reflétant ton niveau de certitude
      - Un prix unitaire estimatif (en EUR) si possible (optionnel)
      
      Il est CRUCIAL de préciser que cette estimation est une pré-estimation et qu'une 'review humaine est obligatoire'.
    `;

    // Utilisation du modèle gemini-3.1-pro-preview avec le mode Thinking pour une analyse complexe de plans
    const response = await ai.models.generateContent({
      model: "gemini-3.1-pro-preview",
      contents: [
        {
          parts: [
            { text: prompt },
            { inlineData: { data: fileData, mimeType: mimeType } }
          ]
        }
      ],
      config: {
        thinkingConfig: { thinkingLevel: ThinkingLevel.HIGH },
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              name: { type: Type.STRING, description: "Nom de l'élément (ex: Mur en briques, Porte intérieure)" },
              quantity: { type: Type.NUMBER, description: "Quantité estimée" },
              unit: { type: Type.STRING, description: "Unité (ex: u, m2, ml)" },
              category: { type: Type.STRING, description: "Catégorie (ex: Menuiserie, Plomberie)" },
              evidence: { type: Type.STRING, description: "Explication détaillée du calcul ou de la déduction" },
              confidence: { type: Type.NUMBER, description: "Score de confiance entre 0.0 et 1.0" },
              unitPrice: { type: Type.NUMBER, description: "Prix unitaire estimé (optionnel)" },
              reviewRequired: { type: Type.BOOLEAN, description: "Toujours true, indique qu'une révision humaine est obligatoire" }
            },
            required: ["name", "quantity", "unit", "category", "evidence", "confidence", "reviewRequired"]
          }
        }
      }
    });

    const jsonStr = response.text?.trim() || "[]";
    const parsedResults = JSON.parse(jsonStr);

    // Forcer reviewRequired à true pour tous les éléments, par sécurité
    const draftQuote = parsedResults.map((item: any) => ({
      ...item,
      reviewRequired: true,
      status: "draft"
    }));

    return NextResponse.json({ 
      success: true, 
      message: "Pré-estimation générée. Une révision humaine est obligatoire.",
      count: draftQuote.length,
      draftQuote: draftQuote 
    });

  } catch (error: any) {
    console.error("Erreur lors de la pré-estimation sur plan:", error);
    return NextResponse.json(
      { success: false, error: error.message || "Erreur interne du serveur" },
      { status: 500 }
    );
  }
}
