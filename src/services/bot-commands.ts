import { Bot, Context } from 'grammy'
import { formatDate } from '@/utils/format'
import { getHelperByTelegramId, registerHelper, getHelperAssignments } from './helpers'
import { getNextEvent, getUpcomingEvents, getEventById, getHelperNames } from './events'
import { recordVote } from './attendance'
import { handleReviewCallback, handleReviewText } from './review-ping'
import { ADMIN_TELEGRAM_USER_IDS, APP_URL, isAdmin } from './admins'
import { sendTelegramMessage, wasReminderSent } from './reminders'
import {
  eventForNewPhoto,
  eventForPosting,
  mediaCounts,
  mediaLabel,
  photoInvite,
  photoTargetChat,
  postMedia,
  removeMedia,
  removeMediaGroup,
  saveMedia,
  sendReviewItems,
  shortDate,
  type MediaType,
} from './photos'
import {
  IDEA_PHOTO_NEEDS_TEXT,
  IDEA_PROMPT,
  cancelInvitation,
  cancelInviteKeyboard,
  checkRegisterCode,
  ensureParentForAdmin,
  findParentByTelegram,
  getEventDate,
  inviteConfirmKeyboard,
  nextInviteEvent,
  saveInvitation,
  saveParentIdea,
  sendFoodInspo,
} from './parents-bot'
import { BUG_PHOTO_NEEDS_TEXT, BUG_PROMPT, saveFeedback } from './feedback'

/**
 * Bot-Befehle.
 *
 * Rollen: Admin (Zugangsliste), Helfer (helpers-Tabelle), Elternteil
 * (parents-Tabelle, per Telegram-ID oder Benutzername). Jeder Befehl prüft
 * seine Rolle; /help zeigt nur, was die Person nutzen darf.
 *
 * /register verlangt den Registrierungs-Code aus den Einstellungen, damit
 * sich Eltern nicht versehentlich als Helfer eintragen.
 */

// Wartet auf den Namen nach erfolgreichem /register (in-memory, Cold-Start setzt zurück)
const pendingRegistrations = new Set<number>()
// Wartet auf den Freitext nach /idee — Fallback, falls jemand nicht "antwortet"
const pendingIdeas = new Set<number>()
// Wartet auf den Text nach /bug
const pendingBugs = new Set<number>()
// Alben kommen als mehrere Nachrichten mit gleicher media_group_id: nur einmal antworten.
const answeredAlbums = new Set<string>()

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/**
 * Reconstructs HTML from plain text + Telegram message entities
 */
function rebuildHtml(text: string, entities: any[]): string {
  if (!entities?.length) return escapeHtml(text)

  const sorted = [...entities].sort((a: any, b: any) => a.offset - b.offset)
  let result = ''
  let pos = 0

  for (const ent of sorted) {
    result += escapeHtml(text.slice(pos, ent.offset))
    const content = escapeHtml(text.slice(ent.offset, ent.offset + ent.length))

    switch (ent.type) {
      case 'bold':
        result += `<b>${content}</b>`
        break
      case 'italic':
        result += `<i>${content}</i>`
        break
      default:
        result += content
        break
    }

    pos = ent.offset + ent.length
  }

  result += escapeHtml(text.slice(pos))
  return result
}

type Role = { helper: any | null; parent: Awaited<ReturnType<typeof findParentByTelegram>>; admin: boolean }

async function roleOf(ctx: Context): Promise<Role> {
  const id = ctx.from?.id
  if (!id) return { helper: null, parent: null, admin: false }
  const [helper, parent] = await Promise.all([
    getHelperByTelegramId(id),
    findParentByTelegram(id, ctx.from?.username),
  ])
  return { helper, parent, admin: isAdmin(id) }
}

const NOT_HELPER = 'Dieser Befehl ist nur für Helfer. Eltern nutzen /idee, /invite und /termine.'
const UNKNOWN =
  'Ich kenne dich noch nicht.\n\n' +
  'Helfer: /register CODE (den Code bekommst du von Marco oder Jens).\n' +
  'Eltern: sag Marco oder Jens Bescheid, dann werdet ihr eingetragen.'

function helpFor(role: Role): string {
  const lines: string[] = []
  if (role.helper) {
    lines.push('<b>Helfer</b>', '/next – nächste Termine mit Team', '/status – nächste Jungschar', '/mystatus – meine Einsätze', 'Fotos oder Videos von der Jungschar? Einfach hier reinschicken.', '/bilder – meine geschickten Bilder, falsche rauswerfen', 'Ideenpool: Button „Ideen“ unten neben dem Eingabefeld')
  }
  if (role.parent || role.helper || role.admin) {
    lines.push('', '<b>Eltern</b>', '/termine – nächste Jungschar-Termine', '/idee – Programm-Idee vorschlagen', '/invite – die Jungschar zu euch einladen', '/inspo – Essensideen für den Jungschar-Besuch')
  }
  if (role.admin) {
    lines.push('', '<b>Admin</b>', '/review – gesammelte Fotos und Videos prüfen, einzelne rauswerfen', '/send – alles Übrige in den Elternchat posten', '/chatid – Chat-ID anzeigen', `Mini-App: ${APP_URL}`)
  }
  if (!role.helper && !role.parent) {
    lines.push('/register CODE – als Helfer registrieren')
  }
  if (role.helper || role.parent || role.admin) {
    lines.push('', '/bug – Fehler oder Wunsch zum Bot melden')
  }
  lines.push('', '/help – diese Übersicht')
  return lines.join('\n').trim()
}

/** Button, der den privaten Chat mit dem Bot öffnet und dort direkt {payload} startet. */
function privateChatButton(ctx: Context, payload: 'idee' | 'invite' | 'inspo' | 'bug') {
  const username = ctx.me.username
  return {
    inline_keyboard: [[{ text: 'Privat schreiben', url: `https://t.me/${username}?start=${payload}` }]],
  }
}

/** Rolle als Wort fürs Feedback. */
function roleLabel(role: Role): string {
  if (role.admin) return 'Admin'
  if (role.helper) return 'Helfer'
  if (role.parent) return 'Eltern'
  return 'unbekannt'
}

/** /bug im privaten Chat: nach der Meldung fragen. */
async function startBugFlow(ctx: Context) {
  if (ctx.from) pendingBugs.add(ctx.from.id)
  await ctx.reply(BUG_PROMPT, {
    reply_markup: { force_reply: true, input_field_placeholder: 'Was ist dir aufgefallen?' },
  })
}

/** /idee im privaten Chat: nach der Idee fragen. */
async function startIdeaFlow(ctx: Context) {
  if (ctx.from) pendingIdeas.add(ctx.from.id)
  await ctx.reply(IDEA_PROMPT, {
    reply_markup: { force_reply: true, input_field_placeholder: 'Worauf hat dein Kind Lust?' },
  })
}

/**
 * DM an die Zugangsliste (Marco, Jens), aber nur, wenn das Sonntags-Heads-up
 * für den Termin schon raus ist. Vorher zeigt das Heads-up die Einladung
 * selbst; danach müssen die beiden das Team informieren.
 */
async function notifyAdminsAfterHeadsUp(eventId: string, line: string): Promise<void> {
  if (!(await wasReminderSent(eventId, 'stage1_sunday'))) return
  const event = await getEventById(eventId)
  const team = event ? getHelperNames(event) : 'Niemand eingetragen'
  const note = `${line}\n👥 Dran sind: ${escapeHtml(team)}\n⚠️ Das Sonntags-Heads-up ist schon raus, sag dem Team bitte Bescheid.`
  for (const adminId of ADMIN_TELEGRAM_USER_IDS) {
    sendTelegramMessage(String(adminId), note).catch((e) => console.error('admin invite notice failed:', e))
  }
}

/**
 * /invite im privaten Chat: nur die nächste Samstags-Jungschar, keine
 * Terminauswahl. Schon vergeben → „zu spät“; selbst eingeladen → Button zum
 * Zurückziehen; frei → Ja/Nein.
 */
async function startInviteFlow(ctx: Context, role: Role) {
  const target = await nextInviteEvent()
  if (!target) {
    await ctx.reply('Gerade steht keine Samstags-Jungschar an. Danke euch, gerne beim nächsten Mal!')
    return
  }
  if (target.takenBy) {
    if (role.parent && target.takenBy.parentId === role.parent.id) {
      await ctx.reply(
        `Ihr habt uns für ${shortDate(target.event_date)} schon eingeladen, danke! Falls es doch nicht klappt, könnt ihr die Einladung hier zurückziehen.`,
        { reply_markup: cancelInviteKeyboard(target.id) },
      )
      return
    }
    await ctx.reply(`Zu spät, für ${shortDate(target.event_date)} war jemand anderes schneller! Gerne bei der nächsten Gelegenheit.`)
    return
  }
  await ctx.reply(`Die nächste Jungschar ist am ${formatDate(target.event_date)}. Wollt ihr uns zu euch einladen?`, {
    reply_markup: inviteConfirmKeyboard(target.id),
  })
}

/**
 * Richtet alle Bot Commands ein
 */
export function setupBotCommands(bot: Bot) {
  // /start – Begrüßung je Rolle. Admins bekommen den Menü-Button "Admin".
  // Mit Deep-Link-Payload (t.me/<bot>?start=idee|invite|inspo|bug|fotos) direkt in den Ablauf springen.
  bot.command('start', async (ctx) => {
    const role = await roleOf(ctx)
    const payload = (ctx.match ?? '').trim().toLowerCase()

    // Button „Momente festgehalten?“ aus der Helfer-Gruppe
    if (ctx.chat.type === 'private' && payload === 'fotos') {
      if (!role.helper && !role.admin) {
        await ctx.reply(role.parent ? 'Fotos sammeln nur die Helfer. Danke dir trotzdem!' : UNKNOWN)
        return
      }
      await ctx.reply(await photoInvite())
      return
    }

    if (ctx.chat.type === 'private' && ['idee', 'invite', 'einladen', 'inspo', 'bug'].includes(payload)) {
      if (!role.helper && !role.parent && !role.admin) {
        await ctx.reply(UNKNOWN)
        return
      }
      if (payload === 'idee') {
        await startIdeaFlow(ctx)
        return
      }
      if (payload === 'inspo') {
        await sendFoodInspo(String(ctx.chat.id))
        return
      }
      if (payload === 'bug') {
        await startBugFlow(ctx)
        return
      }
      if (role.parent || role.admin) {
        await startInviteFlow(ctx, role)
        return
      }
      await ctx.reply('Einladungen kommen von den Eltern. Als Helfer trägst du so etwas im Ideenpool ein.')
      return
    }

    // Menü-Button neben dem Eingabefeld: Admins die ganze App, Helfer nur den Ideenpool.
    if (ctx.chat.type === 'private' && (role.admin || role.helper)) {
      await ctx.api
        .setChatMenuButton({
          chat_id: ctx.chat.id,
          menu_button: role.admin
            ? { type: 'web_app', text: 'Admin', web_app: { url: APP_URL } }
            : { type: 'web_app', text: 'Ideen', web_app: { url: `${APP_URL}/ideen` } },
        })
        .catch((e) => console.error('setChatMenuButton failed:', e))
    }

    let intro: string
    if (role.helper) {
      intro = `Hallo ${escapeHtml(role.helper.name)}! Ich erinnere euch an eure Einsätze und halte die Einteilung aktuell.`
    } else if (role.parent) {
      intro =
        `Hallo ${escapeHtml(role.parent.name)}! Schön, dass du da bist.\n\n` +
        'Mit /idee kannst du uns eine Programm-Idee schicken, mit /invite die Jungschar zu euch nach Hause einladen.'
    } else {
      intro = 'Willkommen beim Jungschar-Bot!\n\n' + UNKNOWN
    }
    await ctx.reply(`${intro}\n\n${helpFor(role)}`, { parse_mode: 'HTML' })
  })

  // /register CODE – nur privat, nur mit gültigem Code
  bot.command('register', async (ctx) => {
    const telegramUserId = ctx.from?.id
    if (!telegramUserId) return
    if (ctx.chat.type !== 'private') {
      await ctx.reply('Bitte schreib mir dafür privat.')
      return
    }

    const existingHelper = await getHelperByTelegramId(telegramUserId)
    if (existingHelper) {
      await ctx.reply(`Du bist bereits als "${existingHelper.name}" registriert.`)
      return
    }

    const check = await checkRegisterCode(ctx.match)
    if (check === 'closed') {
      await ctx.reply('Die Registrierung ist gerade geschlossen. Sag Marco oder Jens Bescheid.')
      return
    }
    if (check === 'wrong') {
      await ctx.reply('Dafür brauchst du den Registrierungs-Code: /register CODE\nDen Code bekommst du von Marco oder Jens.')
      return
    }

    await ctx.reply('Wie heißt du? Bitte antworte mit deinem Namen, so wie er in der Helfer-Liste stehen soll.')
    pendingRegistrations.add(telegramUserId)
  })

  // /next – Nächste Termine mit Team (Helfer)
  bot.command('next', async (ctx) => {
    const role = await roleOf(ctx)
    if (!role.helper) {
      await ctx.reply(NOT_HELPER)
      return
    }
    const events = await getUpcomingEvents(5)
    if (events.length === 0) {
      await ctx.reply('Keine anstehenden Termine gefunden.')
      return
    }
    const lines = events.map((event: any) => `📅 ${formatDate(event.event_date)}: ${getHelperNames(event)}`)
    await ctx.reply(`Nächste Jungschar-Termine:\n\n${lines.join('\n')}`)
  })

  // /termine – Nächste Termine ohne Team (Eltern und Helfer)
  bot.command('termine', async (ctx) => {
    const role = await roleOf(ctx)
    if (!role.helper && !role.parent) {
      await ctx.reply(UNKNOWN)
      return
    }
    const events = await getUpcomingEvents(6)
    if (events.length === 0) {
      await ctx.reply('Keine anstehenden Termine gefunden.')
      return
    }
    const lines = events.map((event: any) => `📅 ${formatDate(event.event_date)}`)
    await ctx.reply(`Nächste Jungschar-Termine:\n\n${lines.join('\n')}`)
  })

  // /status – Nächste Jungschar mit Team (Helfer)
  bot.command('status', async (ctx) => {
    const role = await roleOf(ctx)
    if (!role.helper) {
      await ctx.reply(NOT_HELPER)
      return
    }
    const event = await getNextEvent()
    if (!event) {
      await ctx.reply('Keine anstehende Jungschar gefunden.')
      return
    }
    await ctx.reply(`📅 Nächste Jungschar: ${formatDate(event.event_date)}\n\n👥 Team: ${getHelperNames(event)}`)
  })

  // /mystatus – Meine Einsätze (Helfer)
  bot.command('mystatus', async (ctx) => {
    const role = await roleOf(ctx)
    if (!role.helper) {
      await ctx.reply(NOT_HELPER)
      return
    }
    const assignments = await getHelperAssignments(role.helper.id)
    if (assignments.length === 0) {
      await ctx.reply(`Hallo ${role.helper.name}! Du hast aktuell keine Einsätze geplant.`)
      return
    }
    const lines = assignments.filter((a: any) => a.event).map((a: any) => `📅 ${formatDate(a.event.event_date)}`)
    await ctx.reply(`👋 Hallo ${role.helper.name}!\n\nDeine nächsten Einsätze:\n${lines.join('\n')}`)
  })

  // /idee – Programm-Idee (Eltern und Helfer, privat)
  bot.command('idee', async (ctx) => {
    const role = await roleOf(ctx)
    if (!role.helper && !role.parent) {
      await ctx.reply(UNKNOWN)
      return
    }
    if (ctx.chat.type !== 'private') {
      // Stumm: keine Push-Benachrichtigung für die Gruppe.
      await ctx.reply('Ideen nehme ich privat entgegen, dann bleibt es zwischen uns.', {
        reply_markup: privateChatButton(ctx, 'idee'),
        disable_notification: true,
      })
      return
    }
    await startIdeaFlow(ctx)
  })

  // /invite (alt: /einladen) – „Kommt zu uns“ (Eltern und Admins, privat)
  bot.command(['invite', 'einladen'], async (ctx) => {
    const role = await roleOf(ctx)
    if (!role.parent && !role.admin) {
      await ctx.reply(role.helper ? 'Einladungen kommen von den Eltern. Als Helfer trägst du so etwas im Ideenpool ein.' : UNKNOWN)
      return
    }
    if (ctx.chat.type !== 'private') {
      await ctx.reply('Einladungen nehme ich privat entgegen.', {
        reply_markup: privateChatButton(ctx, 'invite'),
        disable_notification: true,
      })
      return
    }
    await startInviteFlow(ctx, role)
  })

  // /bug – Fehler, Wunsch oder Idee zu Bot und App (alle Bekannten, privat)
  bot.command('bug', async (ctx) => {
    const role = await roleOf(ctx)
    if (!role.helper && !role.parent && !role.admin) {
      await ctx.reply(UNKNOWN)
      return
    }
    if (ctx.chat.type !== 'private') {
      await ctx.reply('Schreib mir das privat, dann geht nichts unter.', {
        reply_markup: privateChatButton(ctx, 'bug'),
        disable_notification: true,
      })
      return
    }
    await startBugFlow(ctx)
  })

  // /inspo – Essens-„Inspiration“ (Spaß): Sterneküche als Album, dann die Auflösung.
  bot.command('inspo', async (ctx) => {
    const role = await roleOf(ctx)
    if (!role.helper && !role.parent && !role.admin) {
      await ctx.reply(UNKNOWN)
      return
    }
    if (ctx.chat.type !== 'private') {
      await ctx.reply('Das zeige ich dir privat.', {
        reply_markup: privateChatButton(ctx, 'inspo'),
        disable_notification: true,
      })
      return
    }
    await sendFoodInspo(String(ctx.chat.id))
  })

  // /bilder – eigene, noch nicht gepostete Fotos und Videos (Helfer, privat),
  // je mit Button zum Rauswerfen, falls etwas falsch geschickt wurde.
  bot.command('bilder', async (ctx) => {
    const role = await roleOf(ctx)
    if (ctx.chat.type !== 'private' || !ctx.from || (!role.helper && !role.admin)) return
    const event = await eventForPosting()
    if (!event) {
      await ctx.reply('Kein Termin gefunden.')
      return
    }
    const shown = await sendReviewItems(String(ctx.chat.id), event, ctx.from.id)
    await ctx.reply(
      shown === 0
        ? `Von dir ist für ${shortDate(event.event_date)} nichts offen. Was schon gepostet ist, kann nur noch im Elternchat gelöscht werden.`
        : `${shown} ${shown === 1 ? 'Medium' : 'Medien'} von dir für ${shortDate(event.event_date)} Falsch geschickt? Einfach drunter rauswerfen.`,
    )
  })

  // /review – gesammelte Fotos und Videos prüfen (Admins, privat). Jedes
  // Medium kommt einzeln mit einem Button zum Rauswerfen (phx_<id>).
  bot.command('review', async (ctx) => {
    if (!isAdmin(ctx.from?.id ?? 0) || ctx.chat.type !== 'private') return
    const event = await eventForPosting()
    if (!event) {
      await ctx.reply('Kein Termin gefunden.')
      return
    }
    const counts = await mediaCounts(event.id)
    if (counts.pending === 0) {
      await ctx.reply(
        counts.total > 0
          ? `Alles für ${shortDate(event.event_date)} ist schon gepostet.`
          : `Bis jetzt keine Fotos oder Videos für ${shortDate(event.event_date)}`,
      )
      return
    }
    await sendReviewItems(String(ctx.chat.id), event)
    await ctx.reply(
      `${mediaLabel(counts)} für ${shortDate(event.event_date)} Was nicht rein soll, direkt unter dem Bild rauswerfen. /send postet den Rest.`,
    )
  })

  // /send (alt: /senden) – Fotos und Videos in den Elternchat posten (Admins, privat, mit Rückfrage).
  // "/send test" postet in die Sandbox-Gruppe, ohne die Medien als gepostet zu markieren.
  bot.command(['send', 'senden'], async (ctx) => {
    if (!isAdmin(ctx.from?.id ?? 0) || ctx.chat.type !== 'private') return
    const isTest = (ctx.match ?? '').trim().toLowerCase() === 'test'
    const target = photoTargetChat()
    if (!isTest && !target.chatId) {
      await ctx.reply('Ziel-Gruppe für Fotos ist nicht konfiguriert.')
      return
    }
    if (isTest && !process.env.TELEGRAM_TEST_CHAT_ID) {
      await ctx.reply('Die Sandbox-Gruppe ist nicht konfiguriert (TELEGRAM_TEST_CHAT_ID).')
      return
    }
    const event = await eventForPosting()
    if (!event) {
      await ctx.reply('Kein Termin gefunden.')
      return
    }
    const counts = await mediaCounts(event.id)
    if (counts.pending === 0) {
      await ctx.reply(`Für ${shortDate(event.event_date)} gibt es nichts zu posten.`)
      return
    }
    await ctx.reply(
      `${mediaLabel(counts)} für ${shortDate(event.event_date)} in ${isTest ? 'die Sandbox-Gruppe (Test, ohne Markierung)' : target.label} posten?`,
      {
        reply_markup: {
          inline_keyboard: [[
            { text: 'Ja, posten', callback_data: `${isTest ? 'pht' : 'phs'}_${event.id}` },
            { text: 'Nein', callback_data: `phn_${event.id}` },
          ]],
        },
      },
    )
  })

  // Fotos und Videos im privaten Chat: nur von Helfern (Admins sind Helfer). Eltern sind hier bewusst raus.
  bot.on(['message:photo', 'message:video'], async (ctx) => {
    if (ctx.chat.type !== 'private' || !ctx.from) return
    const role = await roleOf(ctx)

    const repliedTo = ctx.message.reply_to_message?.text

    // Screenshot zu /bug: Bildunterschrift = Meldung.
    if (ctx.message.photo && (pendingBugs.has(ctx.from.id) || repliedTo === BUG_PROMPT || repliedTo === BUG_PHOTO_NEEDS_TEXT)) {
      const groupKey = ctx.message.media_group_id ?? `single_${ctx.message.message_id}`
      if (answeredAlbums.has(groupKey)) return
      answeredAlbums.add(groupKey)
      const caption = (ctx.message.caption ?? '').trim()
      if (!caption) {
        await ctx.reply(BUG_PHOTO_NEEDS_TEXT, { reply_markup: { force_reply: true } })
        return
      }
      pendingBugs.delete(ctx.from.id)
      const name = role.parent?.name ?? role.helper?.name ?? ctx.from.first_name ?? 'Unbekannt'
      const best = ctx.message.photo[ctx.message.photo.length - 1]
      try {
        await saveFeedback(caption, { name, telegramUserId: ctx.from.id, role: roleLabel(role) }, best.file_id)
        await ctx.reply('Danke, ist notiert! Wir schauen es uns an.')
      } catch (e) {
        console.error('saveFeedback (photo) failed:', e)
        await ctx.reply('Speichern hat nicht geklappt. Magst du es später noch einmal versuchen?')
      }
      return
    }

    // Bild zu einer Idee (/idee läuft gerade): Bildunterschrift = Idee.
    // Bei Alben zählt nur das erste Bild, ein Bild pro Idee.
    if (ctx.message.photo && (pendingIdeas.has(ctx.from.id) || repliedTo === IDEA_PROMPT || repliedTo === IDEA_PHOTO_NEEDS_TEXT)) {
      const groupKey = ctx.message.media_group_id ?? `single_${ctx.message.message_id}`
      if (answeredAlbums.has(groupKey)) return
      answeredAlbums.add(groupKey)
      const caption = (ctx.message.caption ?? '').trim()
      if (!caption) {
        await ctx.reply(IDEA_PHOTO_NEEDS_TEXT, { reply_markup: { force_reply: true } })
        return
      }
      pendingIdeas.delete(ctx.from.id)
      const name = role.parent?.name ?? role.helper?.name ?? ctx.from.first_name ?? 'Unbekannt'
      const best = ctx.message.photo[ctx.message.photo.length - 1]
      try {
        await saveParentIdea(caption, { name, telegramUserId: ctx.from.id }, best.file_id)
        await ctx.reply('Danke, Idee mit Bild ist notiert! Wir schauen sie uns an und melden uns, wenn wir sie einplanen.')
      } catch (e) {
        console.error('saveParentIdea (photo) failed:', e)
        await ctx.reply('Speichern hat nicht geklappt. Magst du es später noch einmal versuchen?')
      }
      return
    }

    if (!role.helper && !role.admin) {
      await ctx.reply(role.parent ? 'Fotos sammeln nur die Helfer. Danke dir trotzdem!' : UNKNOWN)
      return
    }
    const event = await eventForNewPhoto()
    if (!event) {
      await ctx.reply('In den letzten drei Tagen war keine Jungschar, deshalb kann ich das keinem Termin zuordnen.')
      return
    }
    // Foto: größte Auflösung nehmen. Video: die Datei selbst.
    const sizes = ctx.message.photo
    const file = ctx.message.video ?? (sizes ? sizes[sizes.length - 1] : null)
    if (!file) return
    const type: MediaType = ctx.message.video ? 'video' : 'photo'
    const name = role.helper?.name ?? ctx.from.first_name
    const album = ctx.message.media_group_id
    const saved = await saveMedia(
      event,
      { fileId: file.file_id, uniqueId: file.file_unique_id, type, mediaGroupId: album },
      { telegramUserId: ctx.from.id, name },
    )

    const groupKey = album ?? `single_${ctx.message.message_id}`
    if (answeredAlbums.has(groupKey)) return
    answeredAlbums.add(groupKey)

    if (saved.result === 'duplicate' && !album) {
      await ctx.reply('Das hatte ich schon.')
      return
    }
    // Keine Info-DM an die Admins: die sehen den Stand über /review.
    // Unter der Bestätigung ein Button zum Sofort-Rauswerfen (einzeln: phu, Album: phg).
    const what = album ? 'Album gespeichert' : 'Gespeichert'
    const next = role.admin
      ? '/review zeigt alles, /send postet es in den Elternchat.'
      : 'Die Admins schauen drüber und posten es in den Elternchat. Einzelne Bilder kannst du mit /bilder rauswerfen.'
    const undo = album
      ? { text: '🗑 Album rauswerfen', callback_data: `phg_${album}` }
      : saved.id ? { text: '🗑 Rauswerfen', callback_data: `phu_${saved.id}` } : null
    await ctx.reply(`Danke! ${what} für ${shortDate(event.event_date)}\n${next}`, {
      reply_markup: undo ? { inline_keyboard: [[undo]] } : undefined,
    })
  })

  // /chatid – nur Admins
  bot.command('chatid', async (ctx) => {
    if (!isAdmin(ctx.from?.id ?? 0)) return
    await ctx.reply(`Chat-ID: <code>${ctx.chat.id}</code>`, { parse_mode: 'HTML' })
  })

  // /help – je Rolle
  bot.command('help', async (ctx) => {
    const role = await roleOf(ctx)
    await ctx.reply(helpFor(role), { parse_mode: 'HTML' })
  })

  // Textnachrichten: Idee-Antwort, Bewertungs-Freitext, Registrierungs-Name
  bot.on('message:text', async (ctx) => {
    const telegramUserId = ctx.from?.id
    const text = ctx.message.text
    const chatId = String(ctx.chat?.id)
    const elternChatId = process.env.TELEGRAM_ELTERN_CHAT_ID

    // In der Elterngruppe hört der Bot nicht mit.
    if (elternChatId && chatId === elternChatId) return
    if (text.startsWith('/')) return
    if (!telegramUserId || ctx.chat?.type !== 'private') return

    const repliedTo = ctx.message.reply_to_message?.text

    // Antwort auf /bug
    if (repliedTo === BUG_PROMPT || repliedTo === BUG_PHOTO_NEEDS_TEXT || pendingBugs.has(telegramUserId)) {
      pendingBugs.delete(telegramUserId)
      const role = await roleOf(ctx)
      const name = role.parent?.name ?? role.helper?.name ?? ctx.from?.first_name ?? 'Unbekannt'
      try {
        await saveFeedback(text, { name, telegramUserId, role: roleLabel(role) })
        await ctx.reply('Danke, ist notiert! Wir schauen es uns an.')
      } catch (e) {
        console.error('saveFeedback failed:', e)
        await ctx.reply('Speichern hat nicht geklappt. Magst du es später noch einmal versuchen?')
      }
      return
    }

    // Antwort auf /idee (per "Antworten" oder direkt danach)
    if (repliedTo === IDEA_PROMPT || repliedTo === IDEA_PHOTO_NEEDS_TEXT || pendingIdeas.has(telegramUserId)) {
      pendingIdeas.delete(telegramUserId)
      const role = await roleOf(ctx)
      const name = role.parent?.name ?? role.helper?.name ?? ctx.from?.first_name ?? 'Unbekannt'
      try {
        await saveParentIdea(text, { name, telegramUserId })
        await ctx.reply('Danke, das ist notiert! Wir schauen uns die Idee an und melden uns, wenn wir sie einplanen.')
      } catch (e) {
        console.error('saveParentIdea failed:', e)
        await ctx.reply('Speichern hat nicht geklappt. Magst du es später noch einmal versuchen?')
      }
      return
    }

    // Offene Abend-Bewertung? Dann ist der Text der Freitext.
    const handled = await handleReviewText(
      telegramUserId,
      text,
      (html) => ctx.reply(html, { parse_mode: 'HTML' }),
      ctx.from?.first_name || ctx.from?.username || 'Jemand',
    )
    if (handled) return

    if (pendingRegistrations.has(telegramUserId)) {
      pendingRegistrations.delete(telegramUserId)
      try {
        const helper = await registerHelper(text.trim(), telegramUserId, ctx.from?.username)
        await ctx.reply(`✅ Super! Du bist jetzt als "${helper.name}" registriert!`)
      } catch (error) {
        await ctx.reply('Fehler bei der Registrierung. Bitte versuche es erneut mit /register CODE')
      }
    }
  })

  // Callback Queries (Inline Buttons)
  bot.on('callback_query:data', async (ctx) => {
    const callbackData = ctx.callbackQuery.data
    const user = ctx.from
    const telegramUserId = user.id
    const userName = user.first_name || user.username || 'Jemand'

    try {
      const [action, eventId, value] = callbackData.split('_')

      // Abend-Bewertung (Sterne / Drinnen-Draußen)
      if (action === 'rvs' || action === 'rvp') {
        const toast = await handleReviewCallback(action, eventId, value ?? '', telegramUserId)
        await ctx.answerCallbackQuery({ text: toast })
        return
      }

      // /review bzw. /bilder: ein Medium rauswerfen (phx_<event_photos.id>).
      // Admins dürfen alles, Helfer nur ihre eigenen.
      if (action === 'phx') {
        const result = await removeMedia(eventId, isAdmin(telegramUserId) ? undefined : telegramUserId)
        await ctx.answerCallbackQuery({
          text: result.removed ? `Rausgeworfen. Noch ${result.remaining} übrig.` : 'Schon weg oder bereits gepostet.',
        })
        try { await ctx.deleteMessage() } catch {}
        return
      }

      // Sofort-Rauswerfen unter der Bestätigung: phu_<id> (einzeln), phg_<media_group_id> (Album).
      // Helfer nur eigene, Admins alles. Die Bestätigung wird zum Hinweis umgeschrieben.
      if (action === 'phu' || action === 'phg') {
        const owner = isAdmin(telegramUserId) ? undefined : telegramUserId
        const removed = action === 'phg'
          ? await removeMediaGroup(eventId, owner)
          : (await removeMedia(eventId, owner)).removed ? 1 : 0
        await ctx.answerCallbackQuery({ text: removed > 0 ? 'Rausgeworfen.' : 'Schon weg oder bereits gepostet.' })
        try {
          await ctx.editMessageText(
            removed > 0
              ? `Rausgeworfen: ${removed} ${removed === 1 ? 'Medium ist' : 'Medien sind'} nicht mehr gespeichert.`
              : 'Nichts mehr zu entfernen, das war schon weg oder ist bereits gepostet.',
          )
        } catch {}
        return
      }

      // /send: Rückfrage beantwortet (phs = Elternchat, pht = Sandbox-Test, phn = Nein)
      if (action === 'phs' || action === 'pht' || action === 'phn') {
        if (!isAdmin(telegramUserId)) {
          await ctx.answerCallbackQuery({ text: 'Nur für Admins.' })
          return
        }
        if (action === 'phn') {
          await ctx.answerCallbackQuery()
          try { await ctx.editMessageText('Alles klar, nichts gepostet.') } catch {}
          return
        }
        const isTest = action === 'pht'
        const target = photoTargetChat()
        const chatId = isTest ? process.env.TELEGRAM_TEST_CHAT_ID : target.chatId
        const event = await getEventById(eventId)
        if (!chatId || !event) {
          await ctx.answerCallbackQuery({ text: 'Nicht möglich.' })
          return
        }
        try {
          const result = await postMedia(chatId, { id: event.id, event_date: event.event_date }, !isTest)
          await ctx.answerCallbackQuery({ text: 'Gepostet!' })
          try {
            await ctx.editMessageText(
              `${result.posted} Medien für ${shortDate(event.event_date)} in ${isTest ? 'der Sandbox-Gruppe gepostet (Test, sie bleiben offen)' : `${target.label} gepostet`}.`,
            )
          } catch {}
        } catch (e: any) {
          await ctx.answerCallbackQuery({ text: 'Fehler beim Posten.' })
          try { await ctx.editMessageText(`Posten hat nicht geklappt: ${escapeHtml(e.message ?? 'unbekannt')}`) } catch {}
        }
        return
      }

      // /invite: Termin gewählt → Rückfrage, bestätigt → eintragen. invx = Einladung zurückziehen.
      if (action === 'inv' || action === 'invy' || action === 'invn' || action === 'invx') {
        let parent = await findParentByTelegram(telegramUserId, user.username)
        if (!parent && isAdmin(telegramUserId)) {
          const helper = await getHelperByTelegramId(telegramUserId)
          parent = await ensureParentForAdmin(telegramUserId, helper?.name ?? userName, user.username)
        }
        if (!parent) {
          await ctx.answerCallbackQuery({ text: 'Ich kenne dich noch nicht.' })
          return
        }
        if (action === 'inv') {
          const date = await getEventDate(eventId)
          if (!date) {
            await ctx.answerCallbackQuery({ text: 'Termin nicht gefunden.' })
            return
          }
          await ctx.answerCallbackQuery()
          try {
            await ctx.editMessageText(`Ihr ladet die Jungschar am ${formatDate(date)} zu euch ein?`, {
              reply_markup: inviteConfirmKeyboard(eventId),
            })
          } catch {}
          return
        }
        if (action === 'invn') {
          await ctx.answerCallbackQuery()
          try {
            await ctx.editMessageText('Alles klar, nichts eingetragen. Mit /invite könnt ihr es jederzeit neu starten.')
          } catch {}
          return
        }
        if (action === 'invx') {
          const cancelled = await cancelInvitation(eventId, parent.id)
          await ctx.answerCallbackQuery({ text: cancelled.ok ? 'Zurückgezogen' : 'Nicht gefunden' })
          try {
            await ctx.editMessageText(
              cancelled.ok && cancelled.eventDate
                ? `Alles klar, eure Einladung für ${formatDate(cancelled.eventDate)} ist zurückgezogen. Der Termin ist wieder frei.`
                : 'Diese Einladung gibt es nicht mehr.',
            )
          } catch {}
          if (cancelled.ok && cancelled.eventDate) {
            await notifyAdminsAfterHeadsUp(
              eventId,
              `🏠 <b>${escapeHtml(parent.name)}</b> hat die Einladung für <b>${formatDate(cancelled.eventDate)}</b> zurückgezogen.`,
            )
          }
          return
        }
        const result = await saveInvitation(eventId, parent)
        await ctx.answerCallbackQuery({ text: result.ok ? 'Eingetragen!' : 'Nicht möglich' })
        try {
          await ctx.editMessageText(result.text)
        } catch {}
        if (result.ok && result.eventDate) {
          await notifyAdminsAfterHeadsUp(
            eventId,
            `🏠 <b>${escapeHtml(parent.name)}</b> lädt die Jungschar am <b>${formatDate(result.eventDate)}</b> zu sich ein.`,
          )
        }
        return
      }

      const event = await getEventById(eventId)
      const eventInfo = event ? formatDate(event.event_date) : 'dem Termin'

      switch (action) {
        case 'votey':
        case 'votec':
        case 'voten': {
          // votec = dabei mit Auto: zählt in der DB als Zusage, das Auto
          // steht nur in der Nachricht.
          const isYes = action !== 'voten'
          const withCar = action === 'votec'
          const msg = ctx.callbackQuery.message
          const text = msg?.text || ''
          const entities = (msg as any)?.entities || []

          // Persist vote in DB so the Thursday non-voter cron can find non-responders.
          // Failures here must not break the in-message rendering below.
          try {
            const helper = await getHelperByTelegramId(telegramUserId)
            if (helper && eventId) {
              await recordVote(eventId, helper.id, isYes)
            }
          } catch (e) {
            console.error('Failed to persist vote:', e)
          }

          // Parse current votes from plain text
          const dabeiMatch = text.match(/✅ Dabei(?:\s*\(\d+\))?: (.+)/)
          const autoMatch = text.match(/🚗 Mit Auto(?:\s*\(\d+\))?: (.+)/)
          const absagenMatch = text.match(/❌ Absagen(?:\s*\(\d+\))?: (.+)/)
          const names = (m: RegExpMatchArray | null) => !m?.[1] || m[1] === '—' ? [] : m[1].split(', ')

          // Remove user from all lists (handles vote change)
          const dabei = names(dabeiMatch).filter(n => n !== userName)
          const auto = names(autoMatch).filter(n => n !== userName)
          const absagen = names(absagenMatch).filter(n => n !== userName)

          if (withCar) {
            auto.push(userName)
          } else if (isYes) {
            dabei.push(userName)
          } else {
            absagen.push(userName)
          }

          // Build new vote lines (HTML-escaped)
          const esc = (s: string) => escapeHtml(s)
          const dabeiLine = dabei.length > 0
            ? `✅ Dabei (${dabei.length}): ${dabei.map(esc).join(', ')}`
            : '✅ Dabei: —'
          const autoLine = auto.length > 0
            ? `🚗 Mit Auto (${auto.length}): ${auto.map(esc).join(', ')}`
            : '🚗 Mit Auto: —'
          const absagenLine = absagen.length > 0
            ? `❌ Absagen (${absagen.length}): ${absagen.map(esc).join(', ')}`
            : '❌ Absagen: —'

          // Rebuild HTML and replace vote lines
          const html = rebuildHtml(text, entities)
            .replace(/✅ Dabei(?:\s*\(\d+\))?: .+/, dabeiLine)
            .replace(/🚗 Mit Auto(?:\s*\(\d+\))?: .+/, autoLine)
            .replace(/❌ Absagen(?:\s*\(\d+\))?: .+/, absagenLine)

          try {
            await ctx.editMessageText(html, {
              parse_mode: 'HTML',
              reply_markup: (msg as any)?.reply_markup,
            })
          } catch {
            // Message not modified (same content) — ignore
          }

          await ctx.answerCallbackQuery({
            text: withCar ? '🚗 Du bist dabei, mit Auto!' : isYes ? '✅ Du bist dabei!' : '❌ Notiert!',
          })
          break
        }

        // Alte Idee-Buttons in archivierten Stage-2-Nachrichten:
        // Klick stumm absorbieren (kein Toast), damit der Spinner verschwindet.
        case 'idea':
          await ctx.answerCallbackQuery()
          break

        // Legacy-Callbacks für alte Nachrichten
        case 'confirm':
        case 'ready':
          await ctx.answerCallbackQuery({ text: `${userName} hat bestätigt!` })
          await ctx.reply(`✅ ${userName} hat bestätigt für ${eventInfo}!`)
          break
        case 'cancel':
          await ctx.answerCallbackQuery({ text: 'Notiert!' })
          await ctx.reply(
            `⚠️ <b>Vertretung gesucht!</b>\n\n${userName} kann am ${eventInfo} nicht.\nKann jemand einspringen?`,
            { parse_mode: 'HTML' }
          )
          break
        case 'help':
          await ctx.answerCallbackQuery({ text: 'Notiert!' })
          await ctx.reply(
            `🆘 <b>Hilfe benötigt!</b>\n\n${userName} braucht Unterstützung für ${eventInfo}.\nWer kann helfen?`,
            { parse_mode: 'HTML' }
          )
          break

        default:
          await ctx.answerCallbackQuery({ text: `Unbekannte Aktion: ${action}` })
      }
    } catch (error) {
      console.error('Error handling callback:', error)
      await ctx.answerCallbackQuery({ text: 'Fehler bei der Verarbeitung' })
    }
  })
}
