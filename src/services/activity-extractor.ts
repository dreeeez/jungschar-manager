import { GoogleGenerativeAI } from '@google/generative-ai'

export interface ExtractionResult {
  is_activity: boolean
  activity: string | null
}

/**
 * Uses Gemini AI to determine if a message from the parent group (Elterngruppe)
 * is an activity announcement for the Jungschar meeting.
 * Returns the extracted activity title if found.
 */
export async function extractActivityFromMessage(text: string): Promise<ExtractionResult> {
  const apiKey = process.env.GEMINI_API_KEY

  if (!apiKey) {
    console.warn('GEMINI_API_KEY not set, skipping activity extraction')
    return { is_activity: false, activity: null }
  }

  try {
    const genAI = new GoogleGenerativeAI(apiKey)
    const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' })

    const prompt = `Du bist Assistent für eine Jungschar-Gruppe (evangelische Kindergruppe, ca. 8-13 Jahre).

Eine Nachricht wurde in der Elterngruppe gesendet:
"${text}"

Frage: Kündigt diese Nachricht eine konkrete Aktivität oder ein Programm für die Kinder an?

Antworte NUR als gültiges JSON (kein Markdown, keine Erklärung):
{"is_activity": true, "activity": "kurze Beschreibung der Aktivität"}
oder
{"is_activity": false, "activity": null}

Beispiele:
- "Heute machen wir eine Schnitzeljagd!" → {"is_activity": true, "activity": "Schnitzeljagd"}
- "Wir backen Kekse und spielen Spiele" → {"is_activity": true, "activity": "Kekse backen und Spiele spielen"}
- "Wann fängt es heute an?" → {"is_activity": false, "activity": null}
- "Danke für heute!" → {"is_activity": false, "activity": null}
- "Heute ist Jungschar um 14 Uhr" → {"is_activity": false, "activity": null}`

    const result = await model.generateContent(prompt)
    const responseText = result.response.text().trim()

    // Remove markdown code blocks if present
    const cleaned = responseText.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '').trim()
    const parsed = JSON.parse(cleaned)

    return {
      is_activity: Boolean(parsed.is_activity),
      activity: parsed.activity || null,
    }
  } catch (error) {
    console.error('Error extracting activity:', error)
    return { is_activity: false, activity: null }
  }
}
