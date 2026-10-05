'use client'

import { ideaPhotoUrl, splitLinks, type PoolIdea } from '@/lib/pool'

/** Aufgeklappte Idee: Bild (falls per /idee geschickt), Text mit anklickbaren Links, Mitbringen. */
export function IdeaBody({ idea }: { idea: PoolIdea }) {
  const photo = ideaPhotoUrl(idea)
  return (
    <>
      {photo && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={photo} alt="" className="max-h-72 w-full rounded-xl object-cover" loading="lazy" />
      )}
      {idea.description && (
        <p className="whitespace-pre-wrap text-[15px] leading-relaxed">
          {splitLinks(idea.description).map((part, i) =>
            part.href ? (
              <a key={i} href={part.href} target="_blank" rel="noreferrer" className="break-all text-accent underline">
                {part.text}
              </a>
            ) : (
              <span key={i}>{part.text}</span>
            ),
          )}
        </p>
      )}
      {idea.material && (
        <p className="text-sm text-muted">
          <span className="font-medium">Mitbringen:</span> {idea.material}
        </p>
      )}
    </>
  )
}
