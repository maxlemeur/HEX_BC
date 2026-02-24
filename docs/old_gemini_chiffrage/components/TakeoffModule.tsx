"use client"

import React, { useState, useRef } from "react"
import { GoogleGenAI, Type, ThinkingLevel } from "@google/genai"
import { UploadCloud, FileText, CheckCircle2, AlertCircle, Loader2, Plus, Trash2, Edit2, Save, FileSpreadsheet, Map } from "lucide-react"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"

type ExtractedItem = {
  id: string
  name: string
  quantity: number
  unit: string
  category: string
  confidence: number
  evidence: string
  unitPrice?: number
}

type ProcessingLevel = 'A' | 'B' | 'C'

export default function TakeoffModule() {
  const [activeTab, setActiveTab] = useState<string>("source")
  const [file, setFile] = useState<File | null>(null)
  const [fileData, setFileData] = useState<string | null>(null)
  const [mimeType, setMimeType] = useState<string | null>(null)
  const [level, setLevel] = useState<ProcessingLevel>('A')
  const [status, setStatus] = useState<'idle' | 'processing' | 'success' | 'error'>('idle')
  const [results, setResults] = useState<ExtractedItem[]>([])
  const [quote, setQuote] = useState<ExtractedItem[]>([])
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0]
    if (!selectedFile) return
    
    setFile(selectedFile)
    setMimeType(selectedFile.type)
    
    // Read file as base64
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result as string
      const base64 = result.split(',')[1]
      setFileData(base64)
    }
    reader.readAsDataURL(selectedFile)
    setStatus('idle')
    setResults([])
  }

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    const droppedFile = e.dataTransfer.files?.[0]
    if (!droppedFile) return
    
    setFile(droppedFile)
    setMimeType(droppedFile.type)
    
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result as string
      const base64 = result.split(',')[1]
      setFileData(base64)
    }
    reader.readAsDataURL(droppedFile)
    setStatus('idle')
    setResults([])
  }

  const processDocument = async () => {
    if (!fileData || !mimeType) return
    
    setStatus('processing')
    setErrorMsg(null)
    
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.NEXT_PUBLIC_GEMINI_API_KEY })
      
      let prompt = ""
      let model = "gemini-3.1-pro-preview"
      let useThinking = false

      if (level === 'A') {
        prompt = "Tu es un expert en chiffrage de construction. Normalise les données brutes fournies dans le document (texte, csv, excel, etc.) en une liste structurée d'équipements et matériaux. Identifie le nom, la quantité, l'unité, la catégorie. Attribue un score de confiance (0.0 à 1.0) et cite la ligne ou l'élément source comme 'evidence'."
      } else if (level === 'B') {
        prompt = "Tu es un expert en chiffrage de construction. Extrait les nomenclatures, listes d'équipements et tableaux (schedules) depuis ce document PDF. Structure les données avec nom, quantité, unité, catégorie. Attribue un score de confiance (0.0 à 1.0) et cite la page ou la section comme 'evidence'."
      } else if (level === 'C') {
        prompt = "Tu es un métreur/économiste de la construction expert. Analyse ce plan (architectural, structure ou MEP). Effectue un 'takeoff' (métré) complet en identifiant et quantifiant les éléments visibles (murs, portes, fenêtres, équipements, etc.). Pour chaque élément, fournis le nom, la quantité estimée, l'unité appropriée (m2, ml, u), la catégorie. Il est CRUCIAL de fournir une 'evidence' détaillée expliquant comment tu as calculé ou déduit cette quantité à partir du plan, et un score de confiance (0.0 à 1.0). Propose également un prix unitaire estimatif (en EUR) si possible."
        useThinking = true
      }

      const config: any = {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              name: { type: Type.STRING, description: "Nom de l'élément" },
              quantity: { type: Type.NUMBER, description: "Quantité" },
              unit: { type: Type.STRING, description: "Unité (ex: u, m2, ml, kg)" },
              category: { type: Type.STRING, description: "Catégorie (ex: Plomberie, Menuiserie)" },
              confidence: { type: Type.NUMBER, description: "Score de confiance entre 0.0 et 1.0" },
              evidence: { type: Type.STRING, description: "Preuve ou calcul" },
              unitPrice: { type: Type.NUMBER, description: "Prix unitaire estimé (optionnel)" }
            },
            required: ["name", "quantity", "unit", "category", "confidence", "evidence"]
          }
        }
      }

      if (useThinking) {
        config.thinkingConfig = { thinkingLevel: ThinkingLevel.HIGH }
      }

      const response = await ai.models.generateContent({
        model: model,
        contents: [
          {
            parts: [
              { text: prompt },
              { inlineData: { data: fileData, mimeType: mimeType } }
            ]
          }
        ],
        config: config
      })

      const jsonStr = response.text?.trim() || "[]"
      const parsedResults = JSON.parse(jsonStr) as Omit<ExtractedItem, 'id'>[]
      
      const resultsWithIds = parsedResults.map(item => ({
        ...item,
        id: Math.random().toString(36).substring(7)
      }))

      setResults(resultsWithIds)
      setStatus('success')
      setActiveTab('results')
      
    } catch (err: any) {
      console.error(err)
      setStatus('error')
      setErrorMsg(err.message || "Une erreur est survenue lors de l'analyse.")
    }
  }

  const addToQuote = (item: ExtractedItem) => {
    if (!quote.find(q => q.id === item.id)) {
      setQuote([...quote, item])
    }
  }

  const addAllToQuote = () => {
    const newItems = results.filter(r => !quote.find(q => q.id === r.id))
    setQuote([...quote, ...newItems])
    setActiveTab('quote')
  }

  const removeFromQuote = (id: string) => {
    setQuote(quote.filter(q => q.id !== id))
  }

  const updateQuoteItem = (id: string, field: keyof ExtractedItem, value: any) => {
    setQuote(quote.map(q => q.id === id ? { ...q, [field]: value } : q))
  }

  const totalQuote = quote.reduce((sum, item) => sum + (item.quantity * (item.unitPrice || 0)), 0)

  return (
    <div className="space-y-6">
      {/* Custom Tabs Navigation */}
      <div className="flex space-x-2 border-b border-slate-200 pb-2">
        <button
          onClick={() => setActiveTab('source')}
          className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${activeTab === 'source' ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'}`}
        >
          1. Source & Configuration
        </button>
        <button
          onClick={() => setActiveTab('results')}
          disabled={results.length === 0 && status !== 'processing'}
          className={`px-4 py-2 text-sm font-medium rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${activeTab === 'results' ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'}`}
        >
          2. Résultats Extraits
          {results.length > 0 && <span className="ml-2 bg-slate-200 text-slate-800 px-2 py-0.5 rounded-full text-xs">{results.length}</span>}
        </button>
        <button
          onClick={() => setActiveTab('quote')}
          className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${activeTab === 'quote' ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'}`}
        >
          3. Devis (Draft)
          {quote.length > 0 && <span className="ml-2 bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded-full text-xs">{quote.length}</span>}
        </button>
      </div>

      {/* Tab Content: Source */}
      {activeTab === 'source' && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <Card className="md:col-span-2">
            <CardHeader>
              <CardTitle>Document Source</CardTitle>
              <CardDescription>Uploadez un plan (PDF/Image) ou un export (CSV/Excel/Texte).</CardDescription>
            </CardHeader>
            <CardContent>
              <div 
                className={`border-2 border-dashed rounded-xl p-10 text-center transition-colors ${file ? 'border-emerald-500 bg-emerald-50' : 'border-slate-300 hover:border-slate-400 bg-slate-50'}`}
                onDragOver={(e) => e.preventDefault()}
                onDrop={handleDrop}
              >
                <input 
                  type="file" 
                  ref={fileInputRef} 
                  className="hidden" 
                  onChange={handleFileSelect}
                  accept=".pdf,.csv,.txt,.xlsx,.png,.jpg,.jpeg"
                />
                
                {file ? (
                  <div className="flex flex-col items-center space-y-2">
                    <FileText className="h-10 w-10 text-emerald-600" />
                    <p className="font-medium text-slate-900">{file.name}</p>
                    <p className="text-sm text-slate-500">{(file.size / 1024 / 1024).toFixed(2)} MB</p>
                    <Button variant="outline" size="sm" onClick={() => setFile(null)} className="mt-4">
                      Changer de fichier
                    </Button>
                  </div>
                ) : (
                  <div className="flex flex-col items-center space-y-4 cursor-pointer" onClick={() => fileInputRef.current?.click()}>
                    <div className="p-4 bg-white rounded-full shadow-sm">
                      <UploadCloud className="h-8 w-8 text-slate-500" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-slate-900">Cliquez ou glissez-déposez un fichier ici</p>
                      <p className="text-xs text-slate-500 mt-1">PDF, CSV, Excel, Images supportés</p>
                    </div>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Niveau d&apos;Analyse</CardTitle>
              <CardDescription>Choisissez la complexité de l&apos;extraction.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div 
                className={`p-4 rounded-lg border-2 cursor-pointer transition-all ${level === 'A' ? 'border-slate-900 bg-slate-50' : 'border-transparent bg-white hover:bg-slate-50'}`}
                onClick={() => setLevel('A')}
              >
                <div className="flex items-center space-x-3">
                  <div className={`p-2 rounded-md ${level === 'A' ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600'}`}>
                    <FileSpreadsheet className="h-5 w-5" />
                  </div>
                  <div>
                    <h4 className="font-medium text-sm">Niveau A : Normalisation</h4>
                    <p className="text-xs text-slate-500 mt-0.5">Exports hétérogènes vers JSON</p>
                  </div>
                </div>
              </div>

              <div 
                className={`p-4 rounded-lg border-2 cursor-pointer transition-all ${level === 'B' ? 'border-slate-900 bg-slate-50' : 'border-transparent bg-white hover:bg-slate-50'}`}
                onClick={() => setLevel('B')}
              >
                <div className="flex items-center space-x-3">
                  <div className={`p-2 rounded-md ${level === 'B' ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600'}`}>
                    <FileText className="h-5 w-5" />
                  </div>
                  <div>
                    <h4 className="font-medium text-sm">Niveau B : Extraction</h4>
                    <p className="text-xs text-slate-500 mt-0.5">Tables et nomenclatures PDF</p>
                  </div>
                </div>
              </div>

              <div 
                className={`p-4 rounded-lg border-2 cursor-pointer transition-all ${level === 'C' ? 'border-slate-900 bg-slate-50' : 'border-transparent bg-white hover:bg-slate-50'}`}
                onClick={() => setLevel('C')}
              >
                <div className="flex items-center space-x-3">
                  <div className={`p-2 rounded-md ${level === 'C' ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600'}`}>
                    <Map className="h-5 w-5" />
                  </div>
                  <div>
                    <h4 className="font-medium text-sm">Niveau C : Pré-estimation</h4>
                    <p className="text-xs text-slate-500 mt-0.5">Takeoff complet sur plan (Thinking)</p>
                  </div>
                </div>
              </div>
            </CardContent>
            <CardFooter>
              <Button 
                className="w-full" 
                onClick={processDocument} 
                disabled={!file || status === 'processing'}
              >
                {status === 'processing' ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Analyse en cours...
                  </>
                ) : (
                  'Lancer l\'Extraction'
                )}
              </Button>
            </CardFooter>
          </Card>
          
          {status === 'error' && (
            <div className="md:col-span-3 p-4 bg-red-50 text-red-800 rounded-lg flex items-start space-x-3">
              <AlertCircle className="h-5 w-5 mt-0.5 flex-shrink-0" />
              <div>
                <h4 className="font-medium">Erreur lors de l&apos;analyse</h4>
                <p className="text-sm mt-1">{errorMsg}</p>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Tab Content: Results */}
      {activeTab === 'results' && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle>Résultats de l&apos;Extraction</CardTitle>
              <CardDescription>Vérifiez les quantités extraites et leur niveau de confiance.</CardDescription>
            </div>
            <Button onClick={addAllToQuote} variant="outline" className="shrink-0">
              Tout ajouter au devis
            </Button>
          </CardHeader>
          <CardContent>
            {results.length === 0 ? (
              <div className="text-center py-12 text-slate-500">
                Aucun résultat à afficher.
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Élément</TableHead>
                    <TableHead>Catégorie</TableHead>
                    <TableHead className="text-right">Quantité</TableHead>
                    <TableHead>Unité</TableHead>
                    <TableHead>Confiance</TableHead>
                    <TableHead>Preuve / Source</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {results.map((item) => {
                    const isAdded = quote.some(q => q.id === item.id)
                    return (
                      <TableRow key={item.id} className={item.confidence < 0.7 ? "bg-amber-50/50" : ""}>
                        <TableCell className="font-medium">{item.name}</TableCell>
                        <TableCell>
                          <Badge variant="secondary">{item.category}</Badge>
                        </TableCell>
                        <TableCell className="text-right font-mono">{item.quantity}</TableCell>
                        <TableCell className="text-slate-500">{item.unit}</TableCell>
                        <TableCell>
                          <div className="flex items-center space-x-2">
                            <div className="w-16 h-2 bg-slate-100 rounded-full overflow-hidden">
                              <div 
                                className={`h-full ${item.confidence >= 0.8 ? 'bg-emerald-500' : item.confidence >= 0.5 ? 'bg-amber-500' : 'bg-red-500'}`}
                                style={{ width: `${item.confidence * 100}%` }}
                              />
                            </div>
                            <span className="text-xs text-slate-500">{Math.round(item.confidence * 100)}%</span>
                          </div>
                        </TableCell>
                        <TableCell className="max-w-[250px] truncate text-xs text-slate-500" title={item.evidence}>
                          {item.evidence}
                        </TableCell>
                        <TableCell className="text-right">
                          <Button 
                            size="sm" 
                            variant={isAdded ? "ghost" : "default"}
                            onClick={() => addToQuote(item)}
                            disabled={isAdded}
                          >
                            {isAdded ? <CheckCircle2 className="h-4 w-4 text-emerald-500" /> : <Plus className="h-4 w-4" />}
                          </Button>
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      )}

      {/* Tab Content: Quote Draft */}
      {activeTab === 'quote' && (
        <Card>
          <CardHeader>
            <CardTitle>Devis (Draft)</CardTitle>
            <CardDescription>Ajustez les prix et validez votre chiffrage.</CardDescription>
          </CardHeader>
          <CardContent>
            {quote.length === 0 ? (
              <div className="text-center py-12 text-slate-500">
                Votre devis est vide. Ajoutez des éléments depuis l&apos;onglet Résultats.
              </div>
            ) : (
              <div className="space-y-6">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Élément</TableHead>
                      <TableHead className="text-right">Quantité</TableHead>
                      <TableHead>Unité</TableHead>
                      <TableHead className="text-right">Prix Unitaire (€)</TableHead>
                      <TableHead className="text-right">Total (€)</TableHead>
                      <TableHead></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {quote.map((item) => (
                      <TableRow key={item.id}>
                        <TableCell className="font-medium">{item.name}</TableCell>
                        <TableCell className="text-right">
                          <Input 
                            type="number" 
                            value={item.quantity} 
                            onChange={(e) => updateQuoteItem(item.id, 'quantity', parseFloat(e.target.value) || 0)}
                            className="w-20 text-right ml-auto h-8"
                          />
                        </TableCell>
                        <TableCell className="text-slate-500">{item.unit}</TableCell>
                        <TableCell className="text-right">
                          <Input 
                            type="number" 
                            value={item.unitPrice || ''} 
                            onChange={(e) => updateQuoteItem(item.id, 'unitPrice', parseFloat(e.target.value) || 0)}
                            className="w-24 text-right ml-auto h-8"
                            placeholder="0.00"
                          />
                        </TableCell>
                        <TableCell className="text-right font-mono font-medium">
                          {(item.quantity * (item.unitPrice || 0)).toFixed(2)}
                        </TableCell>
                        <TableCell className="text-right">
                          <Button size="icon" variant="ghost" onClick={() => removeFromQuote(item.id)}>
                            <Trash2 className="h-4 w-4 text-red-500" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                
                <div className="flex justify-end pt-4 border-t border-slate-200">
                  <div className="w-64 space-y-2">
                    <div className="flex justify-between text-sm">
                      <span className="text-slate-500">Sous-total</span>
                      <span className="font-mono">{totalQuote.toFixed(2)} €</span>
                    </div>
                    <div className="flex justify-between font-semibold text-lg pt-2 border-t border-slate-200">
                      <span>Total HT</span>
                      <span className="font-mono">{totalQuote.toFixed(2)} €</span>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </CardContent>
          {quote.length > 0 && (
            <CardFooter className="flex justify-end space-x-2 bg-slate-50 rounded-b-xl border-t border-slate-200">
              <Button variant="outline">Exporter (CSV)</Button>
              <Button>
                <Save className="mr-2 h-4 w-4" />
                Enregistrer le Devis
              </Button>
            </CardFooter>
          )}
        </Card>
      )}
    </div>
  )
}
