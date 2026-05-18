// @ts-types="npm:@types/web-push@3.6.4"
import webPush from 'npm:web-push@3.6.7'
import { createClient } from 'npm:@supabase/supabase-js@2'

type PushEventRecord = {
  application_id?: string
  car_model?: string | null
  full_name?: string | null
  id?: string
}

type PushSubscriptionRow = {
  admin_user_id: string | null
  auth: string
  endpoint: string
  id: string
  p256dh: string
}

const supabaseUrl = Deno.env.get('SUPABASE_URL') || ''
const supabaseSecretKey =
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || readSupabaseSecretKey()
const vapidPublicKey = Deno.env.get('VAPID_PUBLIC_KEY') || ''
const vapidPrivateKey = Deno.env.get('VAPID_PRIVATE_KEY') || ''
const vapidSubject =
  Deno.env.get('VAPID_SUBJECT') || 'mailto:admin@example.com'
const functionSecret = Deno.env.get('ADMIN_PUSH_FUNCTION_SECRET') || ''

if (vapidPublicKey && vapidPrivateKey) {
  webPush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey)
}

Deno.serve(async (request) => {
  if (request.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405)
  }

  if (
    !supabaseUrl ||
    !supabaseSecretKey ||
    !functionSecret ||
    !vapidPublicKey ||
    !vapidPrivateKey
  ) {
    return json({ error: 'Missing Web Push environment variables' }, 500)
  }

  if (request.headers.get('x-admin-push-secret') !== functionSecret) {
    return json({ error: 'Unauthorized' }, 401)
  }

  const body = await request.json().catch(() => ({}))
  const record = ((body.record || body) ?? {}) as PushEventRecord
  const applicationId = record.application_id || record.id || ''
  const applicantName = record.full_name || 'Novo candidato'
  const carModel = record.car_model || 'Carro nao informado'
  const supabase = createClient(supabaseUrl, supabaseSecretKey, {
    auth: {
      persistSession: false,
    },
  })

  const { data: subscriptions, error: subscriptionError } = await supabase
    .from('admin_push_subscriptions')
    .select('id, admin_user_id, endpoint, p256dh, auth')
    .eq('status', 'active')

  if (subscriptionError) {
    console.error(subscriptionError)
    return json({ error: 'Could not load push subscriptions' }, 500)
  }

  const activeSubscriptions = (subscriptions || []) as PushSubscriptionRow[]

  if (activeSubscriptions.length === 0) {
    await markEventProcessed(supabase, record.id)
    return json({ sent: 0, skipped: 0, stale: 0 })
  }

  const adminIds = [
    ...new Set(
      activeSubscriptions
        .map((subscription) => subscription.admin_user_id)
        .filter(Boolean),
    ),
  ] as string[]

  if (adminIds.length === 0) {
    await markEventProcessed(supabase, record.id)
    return json({ sent: 0, skipped: activeSubscriptions.length, stale: 0 })
  }

  const { data: adminUsers, error: adminError } = await supabase
    .from('admin_users')
    .select('id, role')
    .in('id', adminIds)
    .in('role', ['founder', 'admin', 'moderator'])

  if (adminError) {
    console.error(adminError)
    return json({ error: 'Could not validate admin users' }, 500)
  }

  const allowedAdminIds = new Set((adminUsers || []).map((admin) => admin.id))
  const notificationPayload = JSON.stringify({
    body: `${applicantName} - ${carModel}`,
    tag: applicationId
      ? `application-${applicationId}`
      : `application-${Date.now()}`,
    title: 'Nova candidatura',
    url: '/admin',
  })
  let failed = 0
  let sent = 0
  let skipped = 0
  let stale = 0

  for (const subscription of activeSubscriptions) {
    if (
      !subscription.admin_user_id ||
      !allowedAdminIds.has(subscription.admin_user_id)
    ) {
      skipped += 1
      continue
    }

    try {
      await webPush.sendNotification(
        {
          endpoint: subscription.endpoint,
          keys: {
            auth: subscription.auth,
            p256dh: subscription.p256dh,
          },
        },
        notificationPayload,
        {
          TTL: 60 * 60,
        },
      )

      sent += 1
    } catch (error) {
      failed += 1

      const statusCode = Number(
        (error as { statusCode?: number; status?: number }).statusCode ||
          (error as { statusCode?: number; status?: number }).status ||
          0,
      )

      if (statusCode === 404 || statusCode === 410) {
        stale += 1

        await supabase
          .from('admin_push_subscriptions')
          .update({
            status: 'inactive',
            updated_at: new Date().toISOString(),
          })
          .eq('id', subscription.id)
      } else {
        console.error(error)
      }
    }
  }

  await markEventProcessed(supabase, record.id)

  return json({ failed, sent, skipped, stale })
})

function readSupabaseSecretKey() {
  const rawSecretKeys = Deno.env.get('SUPABASE_SECRET_KEYS') || ''

  try {
    const parsedSecretKeys = JSON.parse(rawSecretKeys) as Record<string, string>

    return parsedSecretKeys.default || Object.values(parsedSecretKeys)[0] || ''
  } catch {
    return rawSecretKeys
  }
}

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    headers: {
      'Content-Type': 'application/json',
    },
    status,
  })
}

async function markEventProcessed(
  supabase: ReturnType<typeof createClient>,
  eventId?: string,
) {
  if (!eventId) return

  const { error } = await supabase
    .from('admin_push_events')
    .update({
      processed_at: new Date().toISOString(),
    })
    .eq('id', eventId)

  if (error) {
    console.error(error)
  }
}
