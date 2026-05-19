# NoFvce Crew - Next Steps

## Current Status

MVP foundation completed:

- React + Vite + Tailwind CSS
- Minimal public landing
- Candidate application without account
- Application masks, validations and anonymous-face confirmation
- Supabase applications and members
- Admin approval/rejection flow protected by Supabase Auth
- Admin allowlist through `public.admin_users`
- Admin panel roles: founder, admin and moderator
- Access flags documented in `docs/access-control.md`
- Automatic member creation
- Individual secret member code
- WhatsApp code handoff from admin
- Initial roles: founder, admin, moderator, member
- Private members area
- Member session validation against Supabase on protected routes
- Editable member profile with bio, setup, specs, mods and gallery
- Garage, events, drops, feed, profile and chat routes
- Member drops catalog preview with sizes and release status
- Persistent internal chat table
- Realtime/fallback sync for internal chat
- Private feed with photos, captions, likes and comments
- Realtime/fallback sync for private feed
- Admin moderation for feed posts, feed comments and chat messages
- Sensitive admin actions through Supabase RPCs with database-side role checks
- Founder-only audit logs for approvals, rejection, deletion, role/status changes, events and moderation
- Event tables with member RSVP and admin check-in
- Realtime/fallback sync for member events and RSVP status
- Admin camera/manual scanner for event check-in from member card QR
- Admin attendance CSV export and check-in undo
- QR verification route for member cards
- Member card PNG export
- Private profile page scoped to current member
- Digital member card
- PWA manifest and service worker
- Route-level code splitting for lighter initial bundle
- Setup, schema and cleanup docs

## High Priority

- Add event detail pages with media and participant notes.
- Surface advanced profile data in garage cards and future profile views.
- Review whether admin RPCs should move to Edge Functions only if the app needs a separate backend layer later.

## Medium Priority

- Push notifications for approval, events, drops and posts.
- Persisted drops catalog with stock, sizes and checkout.
- Public NoFvce page with manifesto, media and apply.

## Future

- Free deployment first, then `nofvcecrew.com` when the domain is available.
- Capacitor or React Native wrapper if store publishing becomes necessary.
- Regions/chapters.
- Admin scanner using camera for QR check-in.
- Official media gallery.
