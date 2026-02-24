import { GoogleGenAI, Type } from "@google/genai";
import { NextResponse } from "next/server";
import { z } from "zod";

// 1. Définition du schéma canonique avec Zod
const TakeoffItemSchema = z.object({
  designation: z.string().describe("Désignation ou nom de l'élément (ex: Porte coupe-feu, Béton armé)"),
  quantite: z.number().describe("Quantité totale"),
  unite: z.string().describe("Unité de mesure (ex: m2, m3, ml, u, kg, ens)"),
  categorie: z.string().optional().describe("Catégorie ou lot (ex: Gros oeuvre, Menuiserie, CVC)"),
  reference_plan: z.string().optional().describe("Référence au plan d'origine ou localisation (ex: Plan RDC, Façade Nord)"),
  commentaires: z.string().optional().describe("Notes ou spécifications techniques supplémentaires"),
});

const TakeoffListSchema = z.array(TakeoffItemSchema);

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
      Tu es un expert en économie de la construction et métré.
      Ta tâche est de normaliser les données brutes fournies dans le document ci-joint (qui peut être un CSV, Excel, texte brut, ou un PDF contenant des tableaux).
      
      Convertis ces données hétérogènes en une liste structurée et canonique d'éléments de construction.
      Pour chaque ligne ou élément pertinent trouvé, extrais :
      - La désignation de l'élément
      - La quantité (nombre)
      - L'unité (ex: m2, ml, u, kg)
      - La catégorie ou le lot (si déductible)
      - La référence au plan d'origine ou la localisation (si mentionnée)
      - Des commentaires ou spécifications techniques (si pertinents)
      
      Ignore les lignes de totalisation, les en-têtes de page ou les informations non pertinentes au chiffrage.
      Assure-toi que les quantités sont des nombres valides.
    `;

    // Utilisation du modèle gemini-3.1-pro-preview pour la normalisation de données complexes
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
              designation: { type: Type.STRING },
              quantite: { type: Type.NUMBER },
              unite: { type: Type.STRING },
              categorie: { type: Type.STRING },
              reference_plan: { type: Type.STRING },
              commentaires: { type: Type.STRING }
            },
            required: ["designation", "quantite", "unite"]
          }
        }
      }
    });

    const jsonStr = response.text?.trim() || "[]";
    let parsedResults;
    
    try {
      parsedResults = JSON.parse(jsonStr);
    } catch (e) {
      return NextResponse.json({ error: "Le modèle n'a pas renvoyé un JSON valide." }, { status: 500 });
    }

    // 2. Validation avec Zod
    const validationResult = TakeoffListSchema.safeParse(parsedResults);

    if (!validationResult.success) {
      console.error("Erreur de validation Zod:", validationResult.error);
      return NextResponse.json({ 
        error: "Les données extraites ne respectent pas le schéma canonique.",
        details: validationResult.error.format()
      }, { status: 422 });
    }

    return NextResponse.json({ 
      success: true, 
      count: validationResult.data.length,
      data: validationResult.data 
    });

  } catch (error: any) {
    console.error("Erreur lors de la normalisation:", error);
    return NextResponse.json(
      { success: false, error: error.message || "Erreur interne du serveur" },
      { status: 500 }
    );
  }
}
