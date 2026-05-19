# NoFvce Crew - Access Control

This document explains the user access flags used by the app.

## Admin Users

Table: `public.admin_users`

These users are created in Supabase Auth and then allowed into the app admin
panel by inserting their Auth UUID into `public.admin_users`.

Field: `role`

| Value | Access |
| --- | --- |
| `founder` | Full admin access. Can see all applications, members, phones, access codes, member cards and audit logs. Can approve/reject applications, delete applications, delete members, change member roles/status and manage events. |
| `admin` | Full operational admin access. Can approve/reject applications, delete applications, delete members, change member roles/status and manage events. Cannot see audit logs. |
| `moderator` | Can see applications and members, including phones, access codes and member cards. Can approve applications, reject pending applications, create regular members through approval, moderate chat/feed content and handle event check-in. Cannot delete members, delete applications, manage events, see audit logs or change roles/status. |

Important:

- Supabase Auth login alone is not enough to access `/admin`.
- The Auth user UUID must exist in `public.admin_users`.
- The admin panel role is separate from the member role.

Example:

```sql
insert into public.admin_users (id, email, role)
values ('AUTH_USER_UUID_HERE', 'admin@email.com', 'founder')
on conflict (id) do update
set email = excluded.email,
    role = excluded.role;
```

## Members

Table: `public.members`

Members do not use Supabase Auth in the current MVP. They log in with their
individual `access_code`.

Field: `role`

| Value | Meaning |
| --- | --- |
| `founder` | Crew founder identity inside the member area. Reserved for top-level crew identity and future member-side privileges. |
| `admin` | Admin identity inside the crew/member layer. This does not automatically grant `/admin` access unless the same person also exists in `public.admin_users`. |
| `moderator` | Moderator identity inside the crew/member layer. Prepared for future chat/feed/event moderation. |
| `member` | Default approved member role. Can access the private member app with their secret code. |

Field: `status`

| Value | Meaning |
| --- | --- |
| `active` | Member can log in with their access code and appears in active member views. |
| `inactive` | Member should not be treated as active. The private app validates the stored session against Supabase and blocks access when the member is no longer active. |

Field: `access_code`

| Behavior |
| --- |
| Unique secret code generated when an application is approved. This is what the member uses at `/members/login`. It should be sent privately by WhatsApp and not shared. |

The app stores the active member locally after login, but protected member
routes validate that stored session through `get_member_profile` before opening.
If the member was deleted or inactivated, local access is cleared and the user
returns to login.

Field: `member_number`

| Behavior |
| --- |
| Public-facing sequential member ID shown on the digital member card, for example `NFC-001`. |

Editable profile fields:

| Field | Meaning |
| --- | --- |
| `bio` | Short member/car bio shown in the private member profile. |
| `instagram` | Member Instagram handle. |
| `car_model` | Current car model shown in profile, garage and card contexts. |
| `car_setup` | Full setup description. |
| `car_specs` | Technical specs such as year, version, engine, wheels and tires. |
| `car_mods` | Current modification list. |
| `image_url` | Main vehicle photo shown in the garage and digital member card. Members can replace it from their profile after cropping the preview. |
| `gallery_urls` | Up to 6 public image URLs for the member car gallery. |
| `profile_updated_at` | Last profile edit timestamp. |

Profile edits use the member UUID plus the stored individual `access_code`.
The current MVP keeps that code locally after login so the member can update
their own profile without a Supabase Auth account.

Member-side private content:

| Area | Behavior |
| --- | --- |
| Dashboard and Garage | Active member views are returned only after validating the stored member UUID plus individual `access_code`. |
| Chat | Active members can read and send messages after the same member/code validation. |
| Feed | Active members can read posts, publish posts, like and comment after the same member/code validation. |
| Events | Active members can see released events and confirm/cancel presence while RSVP is open. |
| Profile | Active members can read/update only their own profile/card through the member UUID plus `access_code`. |

Admin-side moderation:

| Area | Behavior |
| --- | --- |
| Feed posts | Founder, admin and moderator users can see recent posts in `/admin` and delete inappropriate posts. |
| Feed comments | Founder, admin and moderator users can see recent comments in `/admin` and delete inappropriate comments. |
| Chat messages | Founder, admin and moderator users can see recent chat messages in `/admin` and delete inappropriate messages. |

## Admin Audit Logs

Table: `public.admin_audit_logs`

Sensitive admin actions are written through Supabase RPC functions instead of
direct table writes from the frontend. Those RPCs validate the current admin
role and write an audit entry with the admin Auth user, role, action, target and
metadata.

Only `founder` users can see the audit tab in `/admin`.

## Applications

Table: `public.applications`

Candidates submit applications without an account.

Field: `status`

| Value | Meaning |
| --- | --- |
| `pending` | Waiting for admin review. |
| `approved` | Approved by admin/moderator. Approval creates a member automatically if one does not exist yet. |
| `rejected` | Rejected by admin/moderator. |

Field: `identity_rule_confirmed`

| Value | Meaning |
| --- | --- |
| `true` | Candidate confirmed the member card photo does not show a clear face unless blurred, masked or anonymous. Required to submit the application. |
| `false` | Candidate did not confirm the identity rule. The database policy blocks public application submission with this value. |

## Current Permission Matrix

| Action | Founder | Admin | Moderator | Member |
| --- | --- | --- | --- | --- |
| Access `/admin` | Yes | Yes | Yes | No |
| See applications | Yes | Yes | Yes | No |
| See members, phones, codes and cards | Yes | Yes | Yes | No |
| Approve pending application | Yes | Yes | Yes | No |
| Reject pending application | Yes | Yes | Yes | No |
| Delete application | Yes | Yes | No | No |
| Delete member | Yes | Yes | No | No |
| Change member role | Yes | Yes | No | No |
| Change member status | Yes | Yes | No | No |
| See admin audit logs | Yes | No | No | No |
| Moderate chat/feed content | Yes | Yes | Yes | No |
| Create/update/delete events | Yes | Yes | No | No |
| See event RSVP, export presence and mark/undo check-in | Yes | Yes | Yes | No |
| Receive live application alerts while `/admin` is open | Yes | Yes | Yes | No |
| Access member app with code | If active member | If active member | If active member | Yes |
| Post, like and comment in private feed | If active member | If active member | If active member | Yes |
| Confirm/cancel event presence | If active member | If active member | If active member | Yes |

## Notes

- `public.admin_users.role` controls `/admin`.
- `public.members.role` controls crew/member identity.
- A person can be both an admin user and a member, but those are two separate
  records and two separate access models.
- Sensitive admin writes now go through Supabase RPCs with database-side role
  checks and audit logs. Direct admin table writes are intentionally avoided in
  the frontend.
