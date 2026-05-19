# NoFvce Crew Roadmap

## Product Direction

NoFvce is a secret, minimal, members-only automotive lifestyle app. Candidates
can apply publicly, but all community content stays private.

## Access Model

- Candidate applies without account.
- Admin approves or rejects.
- Admin signs in with Supabase Auth and must be listed in `public.admin_users`.
- Approval creates a member automatically.
- Each member receives an individual secret code.
- The code is sent through the WhatsApp number from the application.
- Members log in with the secret code only.

Admin panel roles:

- founder: full access, including audit logs.
- admin: full operational access, except audit logs.
- moderator: sees applications/members, approves/rejects pending applications,
  creates regular members, and will moderate chat/feed. Cannot delete members or
  change roles.

Detailed permission matrix: `docs/access-control.md`.

Initial roles:

- founder
- admin
- moderator
- member

## Phase 1 - MVP Foundation

- Public landing
- Application form
- Admin panel
- Supabase Auth admin access
- Database-side admin action RPCs
- Admin audit logs
- Member approval/rejection
- Member creation
- Individual access code
- WhatsApp code handoff
- Members dashboard
- Garage
- Events
- Drops
- Profile
- Editable member profile
- Member car specs, mods and gallery
- Digital member card
- Internal chat route
- Persistent chat messages
- Realtime/fallback chat sync
- Private feed MVP
- Photo posts, captions, likes and comments
- Realtime/fallback feed sync
- Admin feed/chat moderation panel
- Event MVP
- Member RSVP
- Admin event check-in
- Admin QR scanner for event check-in
- Attendance CSV export and check-in undo
- Realtime/fallback event RSVP sync
- QR member verification route
- PWA base
- Drops preview catalog with sizes/status

## Phase 2 - Community

- Member-only access rules
- Advanced member profiles
- Car galleries

## Phase 3 - Events

- Event media and detail pages
- Location/map
- Event chat
- Attendance history

## Phase 4 - Lifestyle

- Persisted drops catalog
- Sizes, stock and checkout
- Wallpapers
- Exclusive content
- Partner benefits
- Badges
- Member achievements

## Phase 5 - Expansion

- Push notifications
- Regions/chapters
- Official media gallery
- Marketplace
- Mobile wrapper with Capacitor or React Native
- Paid domain: `nofvcecrew.com`
