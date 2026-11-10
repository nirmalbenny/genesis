import {
  createUserWithEmailAndPassword, onAuthStateChanged, sendEmailVerification, signInWithEmailAndPassword, signOut,
  type User,
} from 'firebase/auth'
import { ref } from 'vue'
import { auth } from '@/firebase'
import { api } from '@/lib/api'

const user = ref<User | null>(null)
/** Mirrors user.emailVerified; refreshed after the user clicks the link in the verification email. */
const emailVerified = ref(false)

// Resolves once Firebase has restored (or not) the persisted session.
const ready = new Promise<void>((resolve) => {
  onAuthStateChanged(auth, (u) => {
    user.value = u
    emailVerified.value = u?.emailVerified ?? false
    resolve()
    // After the user clicks the email link (often in a new tab) the restored session can lag behind: the
    // account may still read "unverified", or read verified while the cached ID token does not. Sync both.
    if (u) refreshVerification().catch((e) => console.warn('Email verification re-check failed', e))
  })
})

// Coming back to an open tab after verifying: pick it up without a reload, on any page.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && auth.currentUser && !emailVerified.value) {
    refreshVerification().catch((e) => console.warn('Email verification re-check failed', e))
  }
})

// The verification link returns the user to the app.
const sendVerification = (u: User) => sendEmailVerification(u, { url: window.location.origin })

async function signUp(email: string, password: string) {
  const cred = await createUserWithEmailAndPassword(auth, email, password)
  await sendVerification(cred.user).catch(() => {}) // can be resent from the dashboard
  return cred
}

/**
 * Brings the session up to date after the user clicked the verification link, and returns true when verified.
 * The server grants the signup credits from the ID token's email_verified claim, which can lag behind the account
 * itself; when it does, the token is refreshed and the credits are claimed (POST /bootstrap is idempotent).
 */
async function refreshVerification(): Promise<boolean> {
  const u = auth.currentUser
  if (!u) return false
  if (!u.emailVerified) await u.reload()
  emailVerified.value = u.emailVerified
  if (!u.emailVerified) return false
  if ((await u.getIdTokenResult()).claims.email_verified !== true) {
    await u.getIdToken(true)
    await api('POST', '/bootstrap')
  }
  return true
}

export function useAuth() {
  return {
    user,
    ready,
    emailVerified,
    signIn: (email: string, password: string) => signInWithEmailAndPassword(auth, email, password),
    signUp,
    signOut: () => signOut(auth),
    resendVerification: () => (auth.currentUser ? sendVerification(auth.currentUser) : Promise.resolve()),
    refreshVerification,
  }
}
