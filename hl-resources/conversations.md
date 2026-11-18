## Conversations
- `usePager('conversations', { query, status: 'all'|'read'|'unread'|'starred', contactId, limit })` (newest message first; `query` searches contact names on the server, from 2 characters, and `total` counts the matches: use it for search, never filter loaded items).
- `usePager('messages', { conversationId, limit })` (newest first; loadMore fetches OLDER ones; for a thread shown oldest-at-top render `[...items].reverse()`; stays empty while `conversationId` is empty).
- `markRead(conversationId)`, `star(conversationId, on)`.
- `sendEmail({ contactId, subject, html })` (goes to the contact's email; verified) and `sendSms({ contactId, message })` (not yet verified on the sandbox: show the returned error clearly). These reach a real person.

Endpoints (verified response shapes):
- `GET /conversations/search` (usePager 'conversations') → items `{ id, contactId, fullName, contactName, email, companyName, tags, lastMessageBody, lastMessageDate (ms), lastMessageType, lastMessageDirection, unreadCount, type }`. `fullName` is in real case.
- `GET /conversations/{conversationId}` → `{ id, contactId, unreadCount, lastMessageBody, lastMessageDate, lastMessageType, type }` (flat, not wrapped). It has NO contact name: keep the list item, or call getContact(contactId).
- `GET /conversations/{conversationId}/messages` (usePager 'messages') → items `{ id, body, direction ('inbound'|'outbound'), dateAdded, messageType, status, meta }`.
    `messageType` seen: `TYPE_SMS`, `TYPE_EMAIL`, and `TYPE_ACTIVITY_*` (e.g. `TYPE_ACTIVITY_APPOINTMENT`): activity entries, not messages; show them as small centered notes, not chat bubbles. Treat any other type as a plain message.
    Email: `body` is plain text and the subject is `meta.email.subject`. `status` is often missing; when it is `failed`, show that clearly.

Not available: marking a conversation unread.
