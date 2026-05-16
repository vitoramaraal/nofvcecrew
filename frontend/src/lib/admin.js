import { getSupabase } from './supabase'

async function runAdminRpc(functionName, params = {}) {
  const client = getSupabase()
  const { data, error } = await client.rpc(functionName, params)

  if (error) {
    throw error
  }

  return data
}

export function approveApplication(applicationId) {
  return runAdminRpc('admin_approve_application', {
    target_application_id: applicationId,
  })
}

export function rejectApplication(applicationId) {
  return runAdminRpc('admin_reject_application', {
    target_application_id: applicationId,
  })
}

export function deleteApplication(applicationId) {
  return runAdminRpc('admin_delete_application', {
    target_application_id: applicationId,
  })
}

export function updateMemberRole(memberId, role) {
  return runAdminRpc('admin_update_member_role', {
    target_member_id: memberId,
    next_role: role,
  })
}

export function updateMemberStatus(memberId, status) {
  return runAdminRpc('admin_update_member_status', {
    target_member_id: memberId,
    next_status: status,
  })
}

export function deleteMember(memberId) {
  return runAdminRpc('admin_delete_member', {
    target_member_id: memberId,
  })
}

export function createCrewEvent(eventData) {
  return runAdminRpc('admin_create_crew_event', {
    event_title: eventData.title,
    event_description: eventData.description,
    event_location: eventData.location,
    event_starts_at: eventData.startsAt,
    event_status: eventData.status,
    event_capacity: eventData.capacity,
  })
}

export function updateCrewEventStatus(eventId, status) {
  return runAdminRpc('admin_update_crew_event_status', {
    target_event_id: eventId,
    next_status: status,
  })
}

export function deleteCrewEvent(eventId) {
  return runAdminRpc('admin_delete_crew_event', {
    target_event_id: eventId,
  })
}

export function checkInEventMember(eventId, memberId) {
  return runAdminRpc('check_in_event_member', {
    target_event_id: eventId,
    target_member_id: memberId,
  })
}

export function resetEventCheckIn(eventId, memberId) {
  return runAdminRpc('admin_reset_event_check_in', {
    target_event_id: eventId,
    target_member_id: memberId,
  })
}

export function deleteFeedPost(postId) {
  return runAdminRpc('admin_delete_feed_post', {
    target_post_id: postId,
  })
}

export function deleteFeedComment(commentId) {
  return runAdminRpc('admin_delete_feed_comment', {
    target_comment_id: commentId,
  })
}

export function deleteChatMessage(messageId) {
  return runAdminRpc('admin_delete_chat_message', {
    target_message_id: messageId,
  })
}
