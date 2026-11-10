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
  })
})

// The verification link returns the user to the app.
const sendVerification = (u: User) => sendEmailVerification(u, { url: window.location.origin })

async function signUp(email: string, password: string) {
  const cred = await createUserWithEmailAndPassword(auth, email, password)
  await sendVerification(cred.user).catch(() => {}) // can be resent from the dashboard
  return cred
}

/**
 * Re-checks verification after the user clicked the email link: reloads the account, refreshes the ID token so
 * the server sees email_verified, then asks the server to grant the signup credits. Returns true when verified.
 */
async function refreshVerification(): Promise<boolean> {
  const u = auth.currentUser
  if (!u) return false
  await u.reload()
  emailVerified.value = u.emailVerified
  if (!u.emailVerified) return false
  await u.getIdToken(true)
  await api('POST', '/bootstrap')
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
