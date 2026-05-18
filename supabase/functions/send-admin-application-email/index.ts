import { createClient } from 'npm:@supabase/supabase-js@2'

type ApplicationRecord = {
  car_model?: string | null
  created_at?: string | null
  full_name?: string | null
  id?: string
  instagram?: string | null
  message?: string | null
  whatsapp?: string | null
}

const supabaseUrl = Deno.env.get('SUPABASE_URL') || ''
const supabaseSecretKey =
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || readSupabaseSecretKey()
const resendApiKey = Deno.env.get('RESEND_API_KEY') || ''
const emailFrom = Deno.env.get('ADMIN_EMAIL_FROM') || ''
const emailSecret = Deno.env.get('ADMIN_EMAIL_FUNCTION_SECRET') || ''
const appUrl = trimTrailingSlash(Deno.env.get('ADMIN_APP_URL') || '')
const configuredRecipients = parseEmailList(Deno.env.get('ADMIN_EMAIL_TO') || '')

Deno.serve(async (request) => {
  if (request.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405)
  }

  if (
    !resendApiKey ||
    !emailFrom ||
    !emailSecret ||
    (configuredRecipients.length === 0 && (!supabaseUrl || !supabaseSecretKey))
  ) {
    return json({ error: 'Missing email environment variables' }, 500)
  }

  if (request.headers.get('x-admin-email-secret') !== emailSecret) {
    return json({ error: 'Unauthorized' }, 401)
  }

  const body = await request.json().catch(() => ({}))
  const application = ((body.record || body.new || body) ??
    {}) as ApplicationRecord
  let recipients: string[]

  try {
    recipients =
      configuredRecipients.length > 0
        ? configuredRecipients
        : await loadAdminEmails()
  } catch (error) {
    console.error(error)
    return json({ error: 'Could not load admin emails' }, 500)
  }

  if (recipients.length === 0) {
    return json({ sent: 0, skipped: true })
  }

  const subject = `Nova candidatura NoFvce: ${
    application.full_name || 'candidato'
  }`
  let response: Response

  try {
    response = await fetch('https://api.resend.com/emails', {
      body: JSON.stringify({
        from: emailFrom,
        html: buildHtml(application),
        subject,
        text: buildText(application),
        to: recipients,
      }),
      headers: {
        Authorization: `Bearer ${resendApiKey}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': application.id
          ? `application-${application.id}`
          : crypto.randomUUID(),
      },
      method: 'POST',
    })
  } catch (error) {
    console.error(error)
    return json({ error: 'Could not reach email provider' }, 502)
  }

  const responseBody = await response.json().catch(() => ({}))

  if (!response.ok) {
    console.error(responseBody)
    return json(
      {
        error: 'Could not send admin email',
        provider_error: responseBody,
      },
      502,
    )
  }

  return json({ provider: responseBody, sent: recipients.length })
})

async function loadAdminEmails() {
  const supabase = createClient(supabaseUrl, supabaseSecretKey, {
    auth: {
      persistSession: false,
    },
  })
  const { data, error } = await supabase
    .from('admin_users')
    .select('email, role')
    .in('role', ['founder', 'admin', 'moderator'])

  if (error) {
    console.error(error)
    throw new Error('Could not load admin emails')
  }

  return [
    ...new Set(
      (data || [])
        .map((admin) => admin.email)
        .filter((email): email is string => Boolean(email)),
    ),
  ]
}

function buildHtml(application: ApplicationRecord) {
  const adminUrl = appUrl ? `${appUrl}/admin` : ''
  const rows = [
    ['Nome', application.full_name],
    ['Instagram', application.instagram],
    ['WhatsApp', application.whatsapp],
    ['Carro', application.car_model],
    ['Mensagem', application.message],
    ['Recebida em', formatDate(application.created_at)],
  ]
    .filter(([, value]) => Boolean(value))
    .map(
      ([label, value]) => `
        <tr>
          <td style="padding:8px 12px;color:#666;font-size:12px;text-transform:uppercase;letter-spacing:.08em;">${escapeHtml(label || '')}</td>
          <td style="padding:8px 12px;color:#111;font-size:14px;">${escapeHtml(value || '')}</td>
        </tr>
      `,
    )
    .join('')

  return `
    <div style="font-family:Inter,Arial,sans-serif;background:#0b0b0b;padding:28px;">
      <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:18px;overflow:hidden;">
        <div style="background:#111;color:#fff;padding:24px;">
          <p style="margin:0 0 8px;font-size:11px;text-transform:uppercase;letter-spacing:.22em;color:#aaa;">NoFvce Crew</p>
          <h1 style="margin:0;font-size:24px;line-height:1.2;">Nova candidatura</h1>
        </div>
        <table style="width:100%;border-collapse:collapse;">${rows}</table>
        ${
          adminUrl
            ? `<div style="padding:20px 24px 28px;"><a href="${escapeHtml(adminUrl)}" style="display:inline-block;background:#111;color:#fff;text-decoration:none;border-radius:999px;padding:12px 18px;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.14em;">Abrir admin</a></div>`
            : ''
        }
      </div>
    </div>
  `
}

function buildText(application: ApplicationRecord) {
  const lines = [
    'Nova candidatura NoFvce',
    '',
    `Nome: ${application.full_name || '-'}`,
    `Instagram: ${application.instagram || '-'}`,
    `WhatsApp: ${application.whatsapp || '-'}`,
    `Carro: ${application.car_model || '-'}`,
    `Mensagem: ${application.message || '-'}`,
    `Recebida em: ${formatDate(application.created_at) || '-'}`,
  ]

  if (appUrl) {
    lines.push('', `Admin: ${appUrl}/admin`)
  }

  return lines.join('\n')
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

function formatDate(value?: string | null) {
  if (!value) return ''

  return new Date(value).toLocaleString('pt-BR', {
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })
}

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    headers: {
      'Content-Type': 'application/json',
    },
    status,
  })
}

function parseEmailList(value: string) {
  return [
    ...new Set(
      value
        .split(',')
        .map((email) => email.trim())
        .filter(Boolean),
    ),
  ]
}

function readSupabaseSecretKey() {
  const rawSecretKeys = Deno.env.get('SUPABASE_SECRET_KEYS') || ''

  try {
    const parsedSecretKeys = JSON.parse(rawSecretKeys) as Record<string, string>

    return parsedSecretKeys.default || Object.values(parsedSecretKeys)[0] || ''
  } catch {
    return rawSecretKeys
  }
}

function trimTrailingSlash(value: string) {
  return value.replace(/\/$/, '')
}
