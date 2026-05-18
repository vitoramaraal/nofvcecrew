import { getSupabase } from './supabase'

const vapidPublicKey = import.meta.env.VITE_ADMIN_PUSH_VAPID_PUBLIC_KEY

export function getAdminPushPermission() {
  if (!isAdminPushSupported()) {
    return 'unsupported'
  }

  return window.Notification.permission
}

export function isAdminPushConfigured() {
  return Boolean(vapidPublicKey)
}

export function isAdminPushSupported() {
  return (
    typeof window !== 'undefined' &&
    'Notification' in window &&
    'serviceWorker' in navigator &&
    'PushManager' in window
  )
}

export async function enableAdminPushNotifications() {
  if (!isAdminPushSupported()) {
    throw new Error('Este navegador nao suporta Web Push.')
  }

  if (!vapidPublicKey) {
    throw new Error(
      'Configure VITE_ADMIN_PUSH_VAPID_PUBLIC_KEY para ativar Web Push.',
    )
  }

  const permission = await window.Notification.requestPermission()

  if (permission !== 'granted') {
    return {
      permission,
      subscription: null,
    }
  }

  await navigator.serviceWorker.register('/sw.js')

  const registration = await navigator.serviceWorker.ready
  const currentSubscription = await registration.pushManager.getSubscription()
  const subscription =
    currentSubscription ||
    (await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
    }))

  const client = getSupabase()
  const { error } = await client.rpc('upsert_admin_push_subscription', {
    admin_user_agent: navigator.userAgent,
    subscription_payload: subscription.toJSON(),
  })

  if (error) {
    throw error
  }

  return {
    permission,
    subscription,
  }
}

function urlBase64ToUint8Array(value) {
  const padding = '='.repeat((4 - (value.length % 4)) % 4)
  const base64 = `${value}${padding}`.replace(/-/g, '+').replace(/_/g, '/')
  const rawData = window.atob(base64)
  const outputArray = new Uint8Array(rawData.length)

  for (let index = 0; index < rawData.length; index += 1) {
    outputArray[index] = rawData.charCodeAt(index)
  }

  return outputArray
}
