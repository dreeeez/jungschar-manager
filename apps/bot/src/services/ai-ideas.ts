import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

export async function generateIdea(context?: {
  month?: number;
  indoor?: boolean;
  ageGroup?: string;
  previousIdeas?: string[];
}): Promise<string> {
  const currentMonth = context?.month ?? new Date().getMonth() + 1;
  const season = getSeason(currentMonth);
  const locationPref = context?.indoor ? 'Drinnen' : 'Drinnen oder Draußen';

  const previousIdeasText = context?.previousIdeas?.length
    ? `\n\nBereits gemachte Aktivitäten (bitte andere vorschlagen):\n${context.previousIdeas.join('\n')}`
    : '';

  const prompt = `Du bist ein kreativer Assistent für Jungschar-Leiter.
Schlage eine Aktivität für Kinder (8-12 Jahre) vor.

Kontext:
- Jahreszeit: ${season}
- Monat: ${currentMonth}
- Ort: ${locationPref} bevorzugt
- Dauer: ca. 2 Stunden
${previousIdeasText}

Gib einen konkreten, umsetzbaren Vorschlag im folgenden Format:

💡 Idee für diese Woche:

🎯 [Name der Aktivität]

[Kurze Beschreibung in 2-3 Sätzen]

📦 Material:
- [Material 1]
- [Material 2]
- [Material 3]

⏱️ Dauer: [geschätzte Zeit]

📝 Anleitung:
1. [Schritt 1]
2. [Schritt 2]
3. [Schritt 3]

Sei kreativ und praxisnah! Die Idee sollte mit einfachen Mitteln umsetzbar sein.`;

  const message = await anthropic.messages.create({
    model: 'claude-3-haiku-20240307',
    max_tokens: 1024,
    messages: [
      {
        role: 'user',
        content: prompt,
      },
    ],
  });

  const textBlock = message.content.find((block) => block.type === 'text');
  if (!textBlock || textBlock.type !== 'text') {
    throw new Error('No text response from AI');
  }

  return textBlock.text;
}

function getSeason(month: number): string {
  if (month >= 3 && month <= 5) return 'Frühling';
  if (month >= 6 && month <= 8) return 'Sommer';
  if (month >= 9 && month <= 11) return 'Herbst';
  return 'Winter';
}
