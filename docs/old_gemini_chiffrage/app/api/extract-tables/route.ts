import { GoogleGenAI, Type } from "@google/genai";
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

    // Initialisation du client Gemini. 
    // En environnement serveur, on utilise la clé API définie dans les variables d'environnement.
    const apiKey = process.env.GEMINI_API_KEY || process.env.NEXT_PUBLIC_GEMINI_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "Clé API Gemini manquante." },
        { status: 500 }
      );
    }

    const ai = new GoogleGenAI({ apiKey });

    const prompt = `
      Tu es un expert en ingénierie, architecture et économie de la construction.
      Analyse ce document PDF (plan, schéma, ou document technique).
      Identifie et extrais tous les tableaux, nomenclatures (Bill of Materials), et listes d'équipements.
      
      Pour chaque élément trouvé dans ces tableaux, extrais les informations suivantes de manière très précise :
      - Le nom ou la désignation de l'équipement/matériau
      - La quantité
      - L'unité (si spécifiée, sinon 'u' ou 'N/A')
      - La catégorie ou le lot (ex: Plomberie, CVC, Électricité, Structure, Menuiserie)
      - Les dimensions ou caractéristiques techniques (si présentes dans le tableau)
      - Une référence exacte de l'emplacement dans le document (ex: "Tableau de menuiserie, page 2", "Cartouche en bas à droite")
      
      Prends en compte les différents formats (tableaux avec ou sans bordures, listes à puces, textes alignés en colonnes).
      Si tu n'es pas sûr d'une valeur, reflète-le dans le score de confiance.
    `;

    // Utilisation du modèle gemini-3.1-pro-preview, idéal pour l'analyse de documents complexes et l'extraction de données structurées.
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
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              name: { type: Type.STRING, description: "Nom ou désignation de l'élément" },
              quantity: { type: Type.NUMBER, description: "Quantité extraite" },
              unit: { type: Type.STRING, description: "Unité de mesure (ex: m2, ml, u, kg)" },
              category: { type: Type.STRING, description: "Catégorie ou lot architectural/ingénierie" },
              specifications: { type: Type.STRING, description: "Dimensions, modèle ou caractéristiques techniques" },
              sourceLocation: { type: Type.STRING, description: "Emplacement exact dans le document source (ex: Page 1, Tableau X)" },
              confidenceScore: { type: Type.NUMBER, description: "Score de confiance de l'extraction (0.0 à 1.0)" }
            },
            required: ["name", "quantity", "unit", "category", "sourceLocation", "confidenceScore"]
          }
        }
      }
    });

    const jsonStr = response.text?.trim() || "[]";
    const parsedResults = JSON.parse(jsonStr);

    return NextResponse.json({ 
      success: true, 
      count: parsedResults.length,
      results: parsedResults 
    });

  } catch (error: any) {
    console.error("Erreur lors de l'extraction des tableaux:", error);
    return NextResponse.json(
      { success: false, error: error.message || "Erreur interne du serveur" },
      { status: 500 }
    );
  }
}
