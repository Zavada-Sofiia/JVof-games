import { env } from '../env';

/** Надсилає лист через Resend. Без ключа (локальна розробка) просто друкує лист у консоль. */
export async function sendMail(to: string, subject: string, text: string, link?: string): Promise<void> {
  if (!env.resendApiKey) {
    console.log(`\n📧 Лист для ${to}\n   Тема: ${subject}\n   ${text}${link ? `\n   Посилання: ${link}` : ''}\n`);
    return;
  }
  const html = `<p>${text}</p>${link ? `<p><a href="${link}">${link}</a></p>` : ''}`;
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.resendApiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: env.mailFrom, to, subject, html, text: link ? `${text}\n\n${link}` : text }),
  });
  if (!res.ok) console.error('Не вдалося надіслати лист', res.status, await res.text().catch(() => ''));
}
