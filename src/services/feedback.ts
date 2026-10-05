import { getSupabase } from './database'
import { sendTelegramMessage } from './reminders'
import { ADMIN_TELEGRAM_USER_IDS } from './admins'

/**
 * /bug: Fehler, Wünsche und Ideen zu Bot und App. Für alle, die der Bot
 * kennt. Landet in `feedback`, Admins bekommen sofort eine DM und sehen die
 * Liste in der Mini-App unter „Feedback“. Der Melder bekommt nur das Danke,
 * keine weitere DM (Eltern werden nie aktiv angeschrieben).
 */

export const BUG_PROMPT =
  'Was ist dir aufgefallen? Ein Fehler, ein Wunsch oder eine Idee zum Bot oder zur App.\n\n' +
  'Schreib es als Antwort auf diese Nachricht, gern mit Screenshot und kurzer Beschreibung dazu.'

export const BUG_PHOTO_NEEDS_TEXT =
  'Danke für den Screenshot! Schreib bitte kurz in die Bildunterschrift, was nicht passt, und schick ihn noch einmal.'

export async function saveFeedback(
  text: string,
  by: { name: string; telegramUserId: number; role: string },
  photoFileId?: string,
): Promise<void> {
  const clean = text.trim()
  const { error } = await getSupabase().from('feedback').insert({
    telegram_user_id: by.telegramUserId,
    name: by.name,
    role: by.role,
    text: clean,
    photo_file_id: photoFileId ?? null,
  } as any)
  if (error) throw error

  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const note =
    `🐞 <b>Feedback von ${esc(by.name)}</b> (${esc(by.role)})${photoFileId ? ' 📷' : ''}\n` +
    `${esc(clean.length > 600 ? clean.slice(0, 599) + '…' : clean)}\n\n` +
    'Liste und Abhaken: Mini-App → Feedback.'
  for (const adminId of ADMIN_TELEGRAM_USER_IDS) {
    sendTelegramMessage(String(adminId), note).catch((e) => console.error('feedback notice failed:', e))
  }
}
